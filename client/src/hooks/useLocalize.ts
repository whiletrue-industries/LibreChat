import { useCallback, useEffect } from 'react';
import { TOptions } from 'i18next';
import { useRecoilValue, useRecoilState } from 'recoil';
import { useTranslation } from 'react-i18next';
import { resources } from '~/locales/i18n';
import { isRTLLang } from './useIsRTL';
import store from '~/store';

export type TranslationKeys = keyof typeof resources.en.translation;

export default function useLocalize() {
  const lang = useRecoilValue(store.lang);
  const [chatDirection, setChatDirection] = useRecoilState(store.chatDirection);
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }
  }, [lang, i18n]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const nextDir = isRTLLang(lang) ? 'rtl' : 'ltr';
    if (document.documentElement.dir !== nextDir) {
      document.documentElement.dir = nextDir;
    }
  }, [lang]);

  useEffect(() => {
    if (!isRTLLang(lang)) {
      return;
    }
    if (typeof chatDirection !== 'string') {
      return;
    }
    if (chatDirection === 'LTR') {
      setChatDirection('RTL');
    }
  }, [lang, chatDirection, setChatDirection]);

  return useCallback(
    (phraseKey: TranslationKeys, options?: TOptions) => t(phraseKey, options),
    [t],
  );
}
