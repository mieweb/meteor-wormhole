import { Meteor } from 'meteor/meteor';
import { Tinytest } from 'meteor/tinytest';
import { RestBridge } from '../lib/rest-bridge';
import { MethodRegistry } from '../lib/registry';
import {
  parseBearerToken,
  currentInvocation,
  currentBearerToken,
  runWithInvocation,
} from '../lib/invocation-context';

const BASE_URL = Meteor.absoluteUrl().replace(/\/$/, '');

// Method that reports its own invocation context back to the caller.
Meteor.methods({
  'invocationTest.whoami'() {
    const inv = currentInvocation();
    return {
      transport: inv ? inv.transport : null,
      bearerToken: currentBearerToken(),
      methodName: inv ? inv.methodName : null,
    };
  },
});

// --- parseBearerToken ---

Tinytest.add('InvocationContext - parseBearerToken extracts token', function (test) {
  test.equal(parseBearerToken('Bearer abc123'), 'abc123');
  test.equal(parseBearerToken('bearer abc123'), 'abc123');
  test.equal(parseBearerToken('Bearer   spaced-token'), 'spaced-token');
});

Tinytest.add('InvocationContext - parseBearerToken rejects non-bearer values', function (test) {
  test.equal(parseBearerToken('Basic dXNlcjpwYXNz'), null);
  test.equal(parseBearerToken('abc123'), null);
  test.equal(parseBearerToken(''), null);
  test.equal(parseBearerToken(undefined), null);
  test.equal(parseBearerToken(null), null);
});

// --- Context isolation ---

Tinytest.add('InvocationContext - undefined outside a transport', function (test) {
  test.equal(currentInvocation(), undefined);
  test.equal(currentBearerToken(), null);
});

Tinytest.addAsync('InvocationContext - runWithInvocation scopes context', async function (test) {
  const fakeReq = { headers: { authorization: 'Bearer scoped-token' } };
  const result = await runWithInvocation(
    { transport: 'rest', req: fakeReq, methodName: 'x' },
    async () => {
      // Context visible across awaits
      await new Promise((r) => setTimeout(r, 5));
      return { token: currentBearerToken(), transport: currentInvocation().transport };
    },
  );
  test.equal(result.token, 'scoped-token');
  test.equal(result.transport, 'rest');
  // Context does not leak after the scope ends
  test.equal(currentInvocation(), undefined);
});

// --- REST bridge integration ---

Tinytest.addAsync('InvocationContext - REST method sees bearer token', async function (test) {
  const registry = new MethodRegistry();
  registry.register('invocationTest.whoami', {
    description: 'whoami',
    inputSchema: { type: 'object', properties: {} },
  });
  const bridge = new RestBridge(registry, { restPath: '/test-rest-invocation' });
  bridge.start();

  try {
    const res = await fetch(`${BASE_URL}/test-rest-invocation/invocationTest_whoami`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer caller-token-42',
      },
      body: JSON.stringify({}),
    });
    test.equal(res.status, 200);
    const body = await res.json();
    test.equal(body.result.transport, 'rest');
    test.equal(body.result.bearerToken, 'caller-token-42');
    test.equal(body.result.methodName, 'invocationTest.whoami');
  } finally {
    bridge.stop();
  }
});

Tinytest.addAsync('InvocationContext - REST without auth header yields null', async function (test) {
  const registry = new MethodRegistry();
  registry.register('invocationTest.whoami', {
    description: 'whoami',
    inputSchema: { type: 'object', properties: {} },
  });
  const bridge = new RestBridge(registry, { restPath: '/test-rest-invocation-noauth' });
  bridge.start();

  try {
    const res = await fetch(`${BASE_URL}/test-rest-invocation-noauth/invocationTest_whoami`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    test.equal(res.status, 200);
    const body = await res.json();
    test.equal(body.result.transport, 'rest');
    test.equal(body.result.bearerToken, null);
  } finally {
    bridge.stop();
  }
});
