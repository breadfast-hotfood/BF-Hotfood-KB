import assert from 'node:assert/strict';
import { listCollectionDocs, FirestoreListError } from '../src/utils/firestoreList';

async function runTests() {
  console.log('Running firestoreList tests...');
  let passedCount = 0;

  // Test 1: runQuery succeeds and correctly decodes document fields and __id
  {
    const fakeFetch: typeof fetch = async (url: any, _init: any) => {
      const u = String(url);
      if (u.endsWith(':runQuery')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              document: {
                name: 'projects/proj-1/databases/db-1/documents/members/user%40example.test',
                fields: {
                  email: { stringValue: 'user@example.test' },
                  count: { integerValue: '42' },
                  score: { doubleValue: 9.5 },
                  active: { booleanValue: true },
                  notes: { nullValue: null },
                  tags: { arrayValue: { values: [{ stringValue: 'dev' }, { stringValue: 'lead' }] } },
                  profile: { mapValue: { fields: { department: { stringValue: 'Engineering' } } } },
                },
              },
            },
          ],
          text: async () => '',
        } as any;
      }
      return { ok: false, status: 404, text: async () => 'Not found' } as any;
    };

    const docs = await listCollectionDocs({
      projectId: 'proj-1',
      databaseId: 'db-1',
      collection: 'members',
      token: 'fake-token',
      fetchImpl: fakeFetch,
    });

    assert.equal(docs.length, 1);
    assert.equal(docs[0].__id, 'user@example.test');
    assert.equal(docs[0].email, 'user@example.test');
    assert.equal(docs[0].count, 42);
    assert.equal(docs[0].score, 9.5);
    assert.equal(docs[0].active, true);
    assert.equal(docs[0].notes, null);
    assert.deepEqual(docs[0].tags, ['dev', 'lead']);
    assert.deepEqual(docs[0].profile, { department: 'Engineering' });
    passedCount++;
    console.log('Test 1 Passed: runQuery succeeds and decodes all field types and __id');
  }

  // Test 2: runQuery fails, fallback to REST list succeeds
  {
    const fakeFetch: typeof fetch = async (url: any, _init: any) => {
      const u = String(url);
      if (u.endsWith(':runQuery')) {
        return {
          ok: false,
          status: 403,
          text: async () => '{"error":{"message":"runQuery denied"}}',
        } as any;
      }
      if (u.includes('/documents/admins')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            documents: [
              {
                name: 'projects/proj-1/databases/db-1/documents/admins/admin%40example.test',
                fields: {
                  email: { stringValue: 'admin@example.test' },
                  role: { stringValue: 'Admin' },
                },
              },
            ],
          }),
          text: async () => '',
        } as any;
      }
      return { ok: false, status: 404, text: async () => 'Not found' } as any;
    };

    const docs = await listCollectionDocs({
      projectId: 'proj-1',
      databaseId: 'db-1',
      collection: 'admins',
      token: 'fake-token',
      fetchImpl: fakeFetch,
    });

    assert.equal(docs.length, 1);
    assert.equal(docs[0].__id, 'admin@example.test');
    assert.equal(docs[0].email, 'admin@example.test');
    assert.equal(docs[0].role, 'Admin');
    passedCount++;
    console.log('Test 2 Passed: runQuery fails, REST list fallback succeeds');
  }

  // Test 3: REST list handles multi-page pagination using nextPageToken
  {
    const fakeFetch: typeof fetch = async (url: any, _init: any) => {
      const u = String(url);
      if (u.endsWith(':runQuery')) {
        return {
          ok: false,
          status: 400,
          text: async () => '{"error":{"message":"bad query"}}',
        } as any;
      }
      if (u.includes('pageToken=page2Token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            documents: [
              {
                name: 'projects/proj-1/databases/db-1/documents/blocked/b2%40example.test',
                fields: { email: { stringValue: 'b2@example.test' } },
              },
            ],
          }),
          text: async () => '',
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          documents: [
            {
              name: 'projects/proj-1/databases/db-1/documents/blocked/b1%40example.test',
              fields: { email: { stringValue: 'b1@example.test' } },
            },
          ],
          nextPageToken: 'page2Token',
        }),
        text: async () => '',
      } as any;
    };

    const docs = await listCollectionDocs({
      projectId: 'proj-1',
      databaseId: 'db-1',
      collection: 'blocked',
      token: 'fake-token',
      fetchImpl: fakeFetch,
    });

    assert.equal(docs.length, 2);
    assert.equal(docs[0].__id, 'b1@example.test');
    assert.equal(docs[1].__id, 'b2@example.test');
    passedCount++;
    console.log('Test 3 Passed: REST list handles multi-page pagination');
  }

  // Test 4: Both runQuery and REST list fail -> throws FirestoreListError
  {
    const fakeFetch: typeof fetch = async (url: any, _init: any) => {
      const u = String(url);
      if (u.endsWith(':runQuery')) {
        return {
          ok: false,
          status: 403,
          text: async () => '{"error":{"message":"query permission denied"}}',
        } as any;
      }
      return {
        ok: false,
        status: 403,
        text: async () => '{"error":{"message":"list permission denied"}}',
      } as any;
    };

    let caughtError: any = null;
    try {
      await listCollectionDocs({
        projectId: 'proj-1',
        databaseId: 'db-1',
        collection: 'members',
        token: 'fake-token',
        fetchImpl: fakeFetch,
      });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError instanceof FirestoreListError);
    assert.equal(caughtError.status, 403);
    assert.equal(caughtError.attempts.length, 2);
    assert.equal(caughtError.attempts[0].method, 'runQuery');
    assert.equal(caughtError.attempts[0].status, 403);
    assert.equal(caughtError.attempts[1].method, 'list');
    assert.equal(caughtError.attempts[1].status, 403);
    assert(caughtError.message.includes('runQuery -> HTTP 403'));
    assert(caughtError.message.includes('list -> HTTP 403'));
    passedCount++;
    console.log('Test 4 Passed: Both attempts fail, throws FirestoreListError with details');
  }

  // Test 5: runQuery throws network exception, list fails -> throws FirestoreListError
  {
    const fakeFetch: typeof fetch = async (url: any, _init: any) => {
      const u = String(url);
      if (u.endsWith(':runQuery')) {
        throw new Error('Network timeout');
      }
      return {
        ok: false,
        status: 500,
        text: async () => '{"error":{"message":"server error"}}',
      } as any;
    };

    let caughtError: any = null;
    try {
      await listCollectionDocs({
        projectId: 'proj-1',
        databaseId: 'db-1',
        collection: 'admins',
        token: 'fake-token',
        fetchImpl: fakeFetch,
      });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError instanceof FirestoreListError);
    assert.equal(caughtError.status, 500);
    assert.equal(caughtError.attempts[0].method, 'runQuery');
    assert.equal(caughtError.attempts[0].status, 0);
    assert(caughtError.attempts[0].body.includes('Network timeout'));
    assert.equal(caughtError.attempts[1].method, 'list');
    assert.equal(caughtError.attempts[1].status, 500);
    passedCount++;
    console.log('Test 5 Passed: Network error on runQuery + list failure throws FirestoreListError');
  }

  // Test 6: Empty collection returns empty array (HTTP 200 / PASS)
  {
    const fakeFetch: typeof fetch = async (url: any, _init: any) => {
      const u = String(url);
      if (u.endsWith(':runQuery')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
          text: async () => '[]',
        } as any;
      }
      return { ok: false, status: 404, text: async () => 'Not found' } as any;
    };

    const docs = await listCollectionDocs({
      projectId: 'proj-1',
      databaseId: 'db-1',
      collection: 'blocked',
      token: 'fake-token',
      fetchImpl: fakeFetch,
    });

    assert(Array.isArray(docs));
    assert.equal(docs.length, 0);
    passedCount++;
    console.log('Test 6 Passed: Empty collection returns empty array (HTTP 200 PASS)');
  }

  console.log(`\nAll ${passedCount} of 6 firestoreList tests passed successfully!`);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
