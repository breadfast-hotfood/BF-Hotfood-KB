// Installs the in-browser API (see utils/localApi.ts). Imported first by main.tsx so it is active before the app runs.
import firebaseConfig from '../firebase-applet-config.json';
import { createLocalApi, installFetchInterceptor } from './utils/localApi';
import { SAMPLE_KB } from './utils/sampleKb';

const realFetch = window.fetch.bind(window);
const api = createLocalApi({
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId,
  fetchImpl: realFetch,
  sample: () => SAMPLE_KB,
});
installFetchInterceptor(api, realFetch);
