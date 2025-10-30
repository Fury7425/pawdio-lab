import { useColorScheme } from 'react-native';
import { tokens, type ThemeMode } from './tokens';

export const useThemeMode = (): ThemeMode => {
  const scheme = useColorScheme();
  return scheme === 'light' ? 'light' : 'dark';
};

export const palette = {
  dark: {
    background: tokens.color.bg.page,
    surface: tokens.color.bg.surface,
    text: tokens.color.text.primary,
  },
  light: {
    background: '#FFFFFF',
    surface: '#F4F6FB',
    text: '#111320',
  },
};
