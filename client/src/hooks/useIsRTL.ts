import { useSyncExternalStore } from 'react';
import { useRecoilValue } from 'recoil';
import store from '~/store';

const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ug']);

export const isRTLLang = (lang: string | null | undefined): boolean => {
  if (lang == null || lang === '') {
    return false;
  }
  const primary = (lang.split('-')[0] || lang).toLowerCase();
  return RTL_LANGS.has(primary);
};

const subscribeToDir = (onChange: () => void): (() => void) => {
  if (typeof document === 'undefined') {
    return () => undefined;
  }
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
  return () => observer.disconnect();
};

const getDocDir = (): string => {
  if (typeof document === 'undefined') {
    return 'ltr';
  }
  return document.documentElement.dir || 'ltr';
};

const getServerDir = (): string => 'ltr';

export default function useIsRTL(): boolean {
  const lang = useRecoilValue(store.lang);
  const chatDirection = useRecoilValue(store.chatDirection);
  const dir = useSyncExternalStore(subscribeToDir, getDocDir, getServerDir);

  if (dir === 'rtl') {
    return true;
  }
  if (isRTLLang(lang)) {
    return true;
  }
  if (typeof chatDirection === 'string' && chatDirection.toLowerCase() === 'rtl') {
    return true;
  }
  return false;
}
