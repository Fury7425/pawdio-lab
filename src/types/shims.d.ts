declare module 'react';
declare module 'react-dom/client';
declare module 'react/jsx-runtime';

declare namespace JSX {
    interface IntrinsicElements {
        [elem: string]: any;
    }
}
