import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import 'antd/dist/reset.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ConfigProvider locale={ruRU} theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#a45bdf', colorBgBase: '#100c18', colorBgContainer: '#15111d', colorBorder: '#493057', colorText: '#eee9f6', borderRadius: 10, fontFamily: 'Inter, system-ui, sans-serif' } }}><App /></ConfigProvider></React.StrictMode>,
);
