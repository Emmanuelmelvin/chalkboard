import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentimentFromRating, sentimentFromText } from '../src/services/feedback/sentiment.js';

test('sentimentFromRating buckets 1-5 stars', () => {
  assert.equal(sentimentFromRating(5), 'positive');
  assert.equal(sentimentFromRating(4), 'positive');
  assert.equal(sentimentFromRating(3), 'neutral');
  assert.equal(sentimentFromRating(2), 'neutral');
  assert.equal(sentimentFromRating(1), 'negative');
});

test('sentimentFromText detects clear complaints', () => {
  assert.equal(sentimentFromText('The dashboard crashes every time I open it.', 'general'), 'negative');
  assert.equal(sentimentFromText('Export is broken and the button is stuck.', 'bug_report'), 'negative');
  assert.equal(sentimentFromText('This is unusable, so slow and laggy.', 'general'), 'negative');
});

test('sentimentFromText detects praise', () => {
  assert.equal(sentimentFromText('This is amazing, I love the new tools!', 'general'), 'positive');
  assert.equal(sentimentFromText('Works perfectly, excellent work. Thanks!', 'general'), 'positive');
});

test('sentimentFromText handles negation', () => {
  assert.equal(sentimentFromText('The sync does not work at all.', 'general'), 'negative');
  assert.equal(sentimentFromText('Not great, sorry.', 'general'), 'negative');
});

test('sentimentFromText keeps short neutral messages neutral', () => {
  assert.equal(sentimentFromText('Can you add a dark mode toggle?', 'feature_request'), 'neutral');
  assert.equal(sentimentFromText('Where can I change my avatar?', 'general'), 'neutral');
});

test('sentimentFromText biases bare bug reports negative', () => {
  assert.equal(sentimentFromText('Upload failed.', 'bug_report'), 'negative');
});
