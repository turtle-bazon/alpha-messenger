// Точка входа Android-клиента.
// Регистрирует нативную инициализацию перед запуском React.
import { setupAndroid } from './android';

// Регистрируем android-инициализацию ДО рендера React,
// чтобы platform.ts знал про callback.
setupAndroid();

// Динамически импортируем main web-клиента — он запустит React.
// web_client/src/main.tsx загрузится и отрендерит приложение.
import('../../web_client/src/main');
