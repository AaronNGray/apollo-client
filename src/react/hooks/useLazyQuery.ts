import { DocumentNode } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { useCallback, useMemo, useRef } from 'react';

import { OperationVariables } from '../../core';
import {
  LazyQueryHookOptions,
  LazyQueryResultTuple,
  QueryResult,
} from '../types/types';
import { useInternalState } from './useQuery';
import { useApolloClient } from './useApolloClient';

// The following methods, when called will execute the query, regardless of
// whether the useLazyQuery execute function was called before.
const EAGER_METHODS = [
  'refetch',
  'fetchMore',
  'updateQuery',
  'startPolling',
  'subscribeToMore',
] as const;

export function useLazyQuery<TData = any, TVariables = OperationVariables>(
  query: DocumentNode | TypedDocumentNode<TData, TVariables>,
  options?: LazyQueryHookOptions<TData, TVariables>
): LazyQueryResultTuple<TData, TVariables> {
  const internalState = useInternalState(
    useApolloClient(options && options.client),
    query,
  );

  const execOptionsRef = useRef<Partial<LazyQueryHookOptions<TData, TVariables>>>();
  const useQueryResult = internalState.useQuery({
    ...options,
    ...execOptionsRef.current,
    // We don’t set skip to execution.called, because some useQuery SSR code
    // checks skip for some reason.
    fetchPolicy: execOptionsRef.current ? options?.fetchPolicy : 'standby',
    skip: undefined,
  });

  const result: QueryResult<TData, TVariables> =
    Object.assign(useQueryResult, {
      called: !!execOptionsRef.current,
    });

  // We use useMemo here to make sure the eager methods have a stable identity.
  const eagerMethods = useMemo(() => {
    const eagerMethods: Record<string, any> = {};
    for (const key of EAGER_METHODS) {
      const method = result[key];
      eagerMethods[key] = (...args: any) => {
        execOptionsRef.current = execOptionsRef.current || {};
        internalState.forceUpdate();
        return (method as any)(...args);
      };
    }

    return eagerMethods;
  }, []);

  Object.assign(result, eagerMethods);

  const execute = useCallback<
    LazyQueryResultTuple<TData, TVariables>[0]
  >(executeOptions => {
    execOptionsRef.current = executeOptions;
    internalState.forceUpdate();

    const promise = result.refetch(executeOptions?.variables)
      .then(apolloQueryResult => internalState.toQueryResult(apolloQueryResult))
      .then(queryResult => Object.assign(queryResult, eagerMethods));

    // Because the return value of `useLazyQuery` is usually floated, we need
    // to catch the promise to prevent unhandled rejections.
    promise.catch(() => {});

    return promise;
  }, []);

  return [execute, result];
}
