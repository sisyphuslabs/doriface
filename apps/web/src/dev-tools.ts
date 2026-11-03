// Development only: render tracking and component picking. Never imported by a production build.
const [{ scan }] = await Promise.all([import("react-scan"), import("react-grab")]);
scan({ enabled: true, showToolbar: true });
