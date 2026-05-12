import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    draftPosts: i.entity({
      slug: i.string().unique().indexed(),
      title: i.string(),
      content: i.string(),
      updatedAt: i.number().indexed(),
      docId: i.string().indexed().optional(),
    }),
  },
  links: {},
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
