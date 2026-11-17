// Recibe la respuesta de Google en la ventanita y se la pasa a la app (misma dirección) sin guardarla aquí.
(function () {
  var hash = location.hash || '';
  history.replaceState(null, '', location.pathname);
  if (window.opener && hash) {
    window.opener.postMessage({ tipo: 'finanzas-oauth', hash: hash }, location.origin);
    window.close();
  }
  var m = document.getElementById('mensaje');
  if (m) m.textContent = 'Ya puedes cerrar esta ventana y volver a la app.';
})();
