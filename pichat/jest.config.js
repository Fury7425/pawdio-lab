module.exports = {
  preset: 'react-native',
  testEnvironment: 'jsdom',
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-navigation|@react-native-async-storage)/)'
  ],
  moduleNameMapper: {
    '^@pichat/(.*)$': '<rootDir>/packages/$1/src',
    '^@pichat-mobile/(.*)$': '<rootDir>/apps/mobile/src/$1'
  }
};
