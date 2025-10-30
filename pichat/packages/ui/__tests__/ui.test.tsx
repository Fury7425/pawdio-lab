import React from 'react';
import { describe, it, expect, vi, beforeAll } from '@jest/globals';
import renderer from 'react-test-renderer';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    __esModule: true,
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    TouchableOpacity: ({ children, onPress, ...props }: any) =>
      React.createElement('TouchableOpacity', { ...props, onPress }, children),
    ActivityIndicator: ({ ...props }: any) => React.createElement('ActivityIndicator', props),
    StyleSheet: { create: (styles: any) => styles },
    TextInput: ({ ...props }: any) => React.createElement('TextInput', props),
    Animated: {
      Value: class {
        constructor(public value: number) {}
        setValue(v: number) {
          this.value = v;
        }
      },
      timing: () => ({ start: (cb?: () => void) => cb && cb() }),
    },
    Switch: ({ ...props }: any) => React.createElement('Switch', props),
    Image: ({ ...props }: any) => React.createElement('Image', props),
    Modal: ({ children }: any) => React.createElement('Modal', null, children),
  };
});

import { Button, ChatBubble, QRCard } from '../src';

describe('ui components', () => {
  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('renders button', () => {
    const tree = renderer.create(<Button title="Send" onPress={() => undefined} />).toJSON();
    expect(tree).toBeTruthy();
  });

  it('renders chat bubble', () => {
    const tree = renderer
      .create(<ChatBubble variant="me" message="Hello" timestamp="now" status="read" />)
      .toJSON();
    expect(tree).toBeTruthy();
  });

  it('renders qr card', () => {
    const tree = renderer
      .create(<QRCard title="My Code" subtitle="Scan me" fingerprint="emoji sequence" />)
      .toJSON();
    expect(tree).toBeTruthy();
  });
});
