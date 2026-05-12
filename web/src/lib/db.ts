import { init } from '@instantdb/react';
import schema from "../../instant.schema";

const APP_ID = "96df9811-8013-4bcf-b8ce-f7f1447ed2be";
const db = init({ appId: APP_ID, schema, devtool: false });

export default db;
