import { describe, it, expect } from 'vitest';
import { safeReturnPath, withNativeFlag, nativeReturnUrl, isNativeApp } from './platform';
import { dailyAlertMessage } from '@/lib/push/messages';

describe('native app helpers', () => {
  it('only follows same-site relative paths', () => {
    expect(safeReturnPath('/welcome?x=1')).toBe('/welcome?x=1');
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined, '/a\nb']) {
      expect(safeReturnPath(bad as string)).toBe('/app');
    }
  });

  it('adds native=1 and keeps existing params', () => {
    const u = new URL(withNativeFlag('https://getmindy.ai/app/auth/callback?next=%2Fwelcome'));
    expect(u.searchParams.get('native')).toBe('1');
    expect(u.searchParams.get('next')).toBe('/welcome');
  });

  it('builds the deep link with the token fragment and a sanitized path', () => {
    expect(nativeReturnUrl('/welcome', '#access_token=abc')).toBe('ai.getmindy.app://auth?to=%2Fwelcome#access_token=abc');
    expect(nativeReturnUrl('https://evil.com', '')).toBe('ai.getmindy.app://auth?to=%2Fapp');
  });

  it('is not native outside the app', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('push copy is singular/plural correct and opens alerts', () => {
    expect(dailyAlertMessage(1).title).toBe('🎯 1 new opportunity');
    expect(dailyAlertMessage(7).title).toBe('🎯 7 new opportunities');
    expect(dailyAlertMessage(7).url).toBe('/app?panel=alerts');
  });
});
