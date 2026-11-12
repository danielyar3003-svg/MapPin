import './ui/style.css';
import { App } from './ui/app';

const app = new App(document.getElementById('app')!);
(window as unknown as { mappinApp: App }).mappinApp = app;
