export const tokens = {
  color: {
    bg: {
      page: '#0B0C0F',
      surface: '#12141A',
    },
    text: {
      primary: '#E6E8F0',
      secondary: '#A7B0C0',
      inverse: '#0B0C0F',
    },
    brand: {
      primary: '#7C5CFF',
    },
    accent: {
      success: '#2ECC71',
      warning: '#F4C542',
      error: '#FF5C5C',
    },
    border: {
      muted: '#2A2F3A',
    },
  },
  spacing: [0, 4, 8, 12, 16, 20, 24, 28, 32],
  radii: {
    sm: 8,
    md: 12,
    lg: 20,
    xl: 28,
  },
  font: {
    family: 'Inter',
    size: {
      display: 28,
      title: 20,
      body: 16,
      caption: 14,
      micro: 12,
    },
  },
};

export type Tone = 'default' | 'success' | 'warning' | 'error';
