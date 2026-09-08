/**
 * Filters State picker — add-another, not replace. Source-shape test: the IIFE
 * must append a second code instead of overwriting the input (that overwrite is
 * why "NY, NJ, PA, DE, CT" could not be typed).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const resolveStart = src.indexOf('function _resolveOneState');
const resolveEnd = src.indexOf('window.__resolveState=_resolveState');
const pickerStart = src.indexOf('// ── STATE picker');
const pickerEnd = src.indexOf('// ── AGENCY + SUB-AGENCY pickers');
const resolve = src.slice(resolveStart, resolveEnd);
const picker = src.slice(pickerStart, pickerEnd);

describe('Filters State is multi-select', () => {
  it('the resolver and picker slices exist', () => {
    expect(resolveStart).toBeGreaterThan(-1);
    expect(pickerStart).toBeGreaterThan(-1);
    expect(resolve).toContain('function _resolveState');
    expect(picker).toContain('function pick(i)');
  });

  it('resolves a CSV of names/codes, not the whole string as one token', () => {
    expect(resolve).toContain('split(/[,;|]/)');
    expect(resolve).toContain('out.join(\',\')');
  });

  it('picking a second state appends instead of replacing', () => {
    expect(picker).toContain('if(codes.indexOf(r.code)<0) codes.push(r.code)');
    expect(picker).not.toContain('inp.value=r.name;');
  });

  it('saved-search restore splits FILT.state onto the input as names', () => {
    expect(src).toContain("String(FILT.state||'').split(',')");
  });
});
