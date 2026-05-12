import { init } from '@instantdb/react';
import schema from "../../instant.schema";

const APP_ID = "505cd366-f7ea-40c0-b0cd-789fc73cae2f";
const db = init({ appId: APP_ID, schema, devtool: false });

export default db;
