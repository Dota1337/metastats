import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLeaks } from './check-error-leaks.mjs';

test('meldet Rohtext in Antwort-Feldern', () => {
  assert.equal(findLeaks("return NextResponse.json({ error: e.message }, { status: 502 });").length, 1);
  assert.equal(findLeaks("return NextResponse.json({ error: 'x', detail: err.message });").length, 1);
  assert.equal(findLeaks("return NextResponse.json({ error: (e as Error).message });").length, 1);
  assert.equal(findLeaks("details: String(error),").length, 1);
  assert.equal(findLeaks([
    "const message = err instanceof Error ? err.message : 'x';",
    'return NextResponse.json({ error: message }, { status: 502 });',
  ].join('\n')).length, 1);
});

test('laesst publicError, Logs, throw und feste Codes durch', () => {
  assert.equal(findLeaks("return NextResponse.json({ error: publicError('x', e, 'db_error') });").length, 0);
  assert.equal(findLeaks("console.error('[x]', e.message);").length, 0);
  assert.equal(findLeaks("if (error) throw new Error(error.message);").length, 0);
  assert.equal(findLeaks("return NextResponse.json({ error: 'rate_limited', message: `Too many` });").length, 0);
  assert.equal(findLeaks([
    "const message = publicError('x', err, 'hetzner_unreachable');",
    'return NextResponse.json({ error: message }, { status: 502 });',
  ].join('\n')).length, 0);
});
