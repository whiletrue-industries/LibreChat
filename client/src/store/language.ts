import Cookies from 'js-cookie';
import { atomWithLocalStorage } from './utils';

// Hebrew-first default. We deliberately ignore navigator.language for new
// users — botnim is a Hebrew-first product and most users would otherwise
// land on English (matching their OS) even though Hebrew is the intended
// experience. Explicit user choice (cookie or localStorage) wins. Closes
// Monday item 2881759582.
const defaultLang = () => {
  return Cookies.get('lang') || localStorage.getItem('lang') || 'he-IL';
};

const lang = atomWithLocalStorage('lang', defaultLang());

export default { lang };
