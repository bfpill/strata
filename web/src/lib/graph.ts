import db from './db'

/* eslint-disable @typescript-eslint/no-explicit-any */

export function useExperiments(opts: { limit?: number; group?: string; status?: string } = {}) {
  const where: any = { status: opts.status ?? 'active' }
  if (opts.group) where.group = opts.group
  return db.useQuery({
    experiments: {
      $: { where, order: { serverCreatedAt: 'desc' as const }, limit: opts.limit ?? 50 },
      runs: { $: { limit: 1 } },
    },
  } as any)
}

export function useExperiment(slug: string) {
  return db.useQuery(
    slug ? {
      experiments: {
        $: { where: { slug } },
        runs: { artifacts: {} },
        comments: {},
        inEdges: { sourceExperiment: {}, sourceDoc: {} },
        outEdges: { targetExperiment: {}, targetDoc: {}, targetArtifact: {} },
      },
    } as any : null
  )
}

export function useExperimentDocs(slug: string) {
  return db.useQuery(
    slug ? {
      edges: {
        $: { where: { relation: 'discusses' } },
        targetExperiment: { $: { where: { slug } } },
        sourceDoc: {},
      },
    } as any : null
  )
}

export function useArtifactsByGroup(group: string, artifactType?: string) {
  const artifactWhere = artifactType ? { where: { artifactType } } : {}
  return db.useQuery({
    experiments: {
      $: { where: { group, status: 'active' } },
      runs: {
        $: { where: { status: 'finalized' } },
        artifacts: { $: artifactWhere },
      },
    },
  } as any)
}

export function useDerivedExperiments(slug: string) {
  return db.useQuery(
    slug ? {
      experiments: {
        $: { where: { slug } },
        inEdges: {
          $: { where: { relation: 'derived_from' } },
          sourceExperiment: {
            runs: { artifacts: {} },
          },
        },
      },
    } as any : null
  )
}

export { db }
