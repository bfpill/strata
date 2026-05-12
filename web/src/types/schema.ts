export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]' | 'record'

export interface FieldDef {
  name: string
  type: FieldType
  required?: boolean
  description?: string
}

export interface ComponentSchema {
  fields: FieldDef[]
  description?: string
}

export interface ComponentMeta<P = Record<string, unknown>> {
  id: string
  name: string
  category: 'chart' | 'layout' | 'data-display' | 'simulation'
  description: string
  schema: ComponentSchema
  component: React.ComponentType<P>
  sampleData: P
  tags?: string[]
  embedTag?: string
  display?: 'inline' | 'wide' | 'full'
}
