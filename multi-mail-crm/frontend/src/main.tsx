import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import 'antd/dist/reset.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ConfigProvider locale={ruRU} theme={{ token: { colorPrimary: '#365bd4', borderRadius: 6, fontFamily: 'Inter, system-ui, sans-serif' } }}><App /></ConfigProvider></React.StrictMode>,
);
