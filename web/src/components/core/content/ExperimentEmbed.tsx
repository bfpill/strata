import db from '@/lib/db'
import { register } from '@/registry'
import { Card, CardHeader, CardBody, Stack, Grid } from '@/components/core/layouts'
import { Stat } from '@/components/core/layouts'
import { API_URL } from '@/api'

export function ExperimentEmbed({ slug }: { slug: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = db.useQuery(slug ? { experiments: { $: { where: { slug } }, runs: { artifacts: {} } } } as any : null)
  const exp = (data as any)?.experiments?.[0]

  if (isLoading) return <div className="text-xs text-zinc-400 font-mono py-4">Loading experiment...</div>
  if (!exp) return <div className="text-xs text-zinc-400 font-mono py-4">Experiment <code className="bg-zinc-100 px-1 rounded">{slug}</code> not found in graph.</div>

  const runs = exp.runs ?? []
  const artifactCount = runs.reduce((n: number, r: any) => n + (r.artifacts?.length ?? 0), 0)

  return (
    <Card>
      <CardHeader>
        <a href={`/e/${slug}`} className="text-blue-600 hover:underline">{exp.title}</a>
      </CardHeader>
      <CardBody>
        <Stack gap={8}>
          <Grid columns={3} gap={8}>
            <Stat value={String(runs.length)} label="runs" />
            <Stat value={String(artifactCount)} label="artifacts" />
            <Stat value={exp.status} label="status" />
          </Grid>
          {exp.group && <div className="text-xs text-zinc-500">Group: <span className="text-zinc-700">{exp.group}</span></div>}
          {exp.intent && <p className="text-xs text-zinc-500">{exp.intent}</p>}
          {exp.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(exp.tags as string[]).map((t: string) => (
                <span key={t} className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          )}
          {runs.length > 0 && runs[0].artifacts?.length > 0 && (
            <div className="text-[10px] text-zinc-400">
              Latest artifacts: {runs[0].artifacts.slice(0, 3).map((a: any) => a.label).filter(Boolean).join(', ')}
            </div>
          )}
        </Stack>
      </CardBody>
    </Card>
  )
}

export function ExperimentArtifact({ slug, label, run }: { slug: string; label: string; run?: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = db.useQuery(slug ? { experiments: { $: { where: { slug } }, runs: { artifacts: { $: { where: { label } } } } } } as any : null)
  const exp = (data as any)?.experiments?.[0]
  const targetRun = run !== undefined ? exp?.runs?.find((r: any) => r.runIndex === run) : exp?.runs?.[0]
  const artifact = targetRun?.artifacts?.[0]

  if (isLoading) return <div className="text-xs text-zinc-400 font-mono py-4">Loading artifact...</div>
  if (!artifact) return <div className="text-xs text-zinc-400 font-mono py-4">Artifact <code className="bg-zinc-100 px-1 rounded">{label}</code> not found.</div>

  if (artifact.artifactType === 'plotly_json') {
    const src = `${API_URL}/data/r2/${artifact.uri.replace('.json', '.html')}`
    return (
      <div className="rounded-lg border border-zinc-200 overflow-hidden">
        <iframe src={src} style={{ width: '100%', height: 400, border: 'none' }} loading="lazy" />
      </div>
    )
  }

  return (
    <div className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg p-3">
      <code>{artifact.label}</code> ({artifact.artifactType}) — <a href={`${API_URL}/data/r2/${artifact.uri}`} className="text-blue-600 hover:underline" target="_blank">View</a>
    </div>
  )
}

register({
  id: 'experiment-embed',
  name: 'Experiment Embed',
  category: 'data-display',
  description: 'Embeds an experiment summary card from the graph. Shows title, runs, artifacts, tags.',
  tags: ['experiment', 'graph', 'embed'],
  schema: { fields: [{ name: 'slug', type: 'string', required: true, description: 'Experiment slug' }] },
  component: ExperimentEmbed as unknown as React.ComponentType<Record<string, unknown>>,
  sampleData: { slug: '' },
  embedTag: 'ExperimentEmbed',
})

register({
  id: 'experiment-artifact',
  name: 'Experiment Artifact',
  category: 'data-display',
  description: 'Renders a specific artifact from an experiment. For plotly_json, shows an inline iframe.',
  tags: ['experiment', 'artifact', 'graph', 'embed'],
  schema: {
    fields: [
      { name: 'slug', type: 'string', required: true, description: 'Experiment slug' },
      { name: 'label', type: 'string', required: true, description: 'Artifact label' },
      { name: 'run', type: 'number', description: 'Run index (default: latest)' },
    ],
  },
  component: ExperimentArtifact as unknown as React.ComponentType<Record<string, unknown>>,
  sampleData: { slug: '', label: '' },
  embedTag: 'ExperimentArtifact',
  display: 'wide',
})
