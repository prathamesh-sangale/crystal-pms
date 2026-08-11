import type { Container } from '@pms/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api, type ChecklistLibrary, type ContainerDetail, type Overview, type Reference } from './api';

/**
 * One key namespace. Every mutation invalidates `overview`, because the stat
 * cards, the sidebar tallies and the board all read from it — a ticked task
 * has to move the count in the sidebar too.
 */
export const keys = {
  overview: ['overview'] as const,
  reference: ['reference'] as const,
  container: (id: string) => ['container', id] as const,
  containers: (query: Record<string, string | undefined>) => ['containers', query] as const,
  checklistLibrary: ['checklist-library'] as const,
};

export function useOverview(): UseQueryResult<Overview, Error> {
  return useQuery({ queryKey: keys.overview, queryFn: api.overview });
}

export function useReference(): UseQueryResult<Reference, Error> {
  return useQuery({ queryKey: keys.reference, queryFn: api.reference, staleTime: 5 * 60_000 });
}

export function useContainer(id: string | null): UseQueryResult<ContainerDetail, Error> {
  return useQuery({
    queryKey: keys.container(id ?? ''),
    queryFn: () => api.container(id as string),
    enabled: Boolean(id),
  });
}

export function useChecklistLibrary(): UseQueryResult<ChecklistLibrary, Error> {
  return useQuery({
    queryKey: keys.checklistLibrary,
    queryFn: api.checklistLibrary,
    staleTime: 5 * 60_000,
  });
}

function useRefreshAfterChange(): (container?: Container) => Promise<void> {
  const client = useQueryClient();
  return async (container) => {
    if (container) client.setQueryData(keys.container(container.id), (old: ContainerDetail | undefined) =>
      old ? { ...old, container } : old
    );
    await Promise.all([
      client.invalidateQueries({ queryKey: keys.overview }),
      client.invalidateQueries({ queryKey: ['containers'] }),
      container ? client.invalidateQueries({ queryKey: keys.container(container.id) }) : null,
    ]);
  };
}

export function useToggleTask() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({ id, key, done }: { id: string; key: string; done: boolean }) =>
      api.toggleTask(id, key, done),
    onSuccess: ({ container }) => refresh(container),
  });
}

export function useAdvanceStage() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => api.advanceStage(id, force),
    onSuccess: ({ container }) => refresh(container),
  });
}

export function useCreateContainer() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: (input: unknown) => api.createContainer(input),
    onSuccess: ({ container }) => refresh(container),
  });
}

export function useUpdateContainer() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: unknown }) => api.updateContainer(id, input),
    onSuccess: ({ container }) => refresh(container),
  });
}

export function useRemoveContainer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeContainer(id),
    onSuccess: async (_data, id) => {
      client.removeQueries({ queryKey: keys.container(id) });
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.overview }),
        client.invalidateQueries({ queryKey: ['containers'] }),
      ]);
    },
  });
}
