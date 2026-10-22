/* =====================================================================
   CATÁLOGO — lógica del sitio (sin librerías)

   Regla de seguridad: NINGÚN texto que viene de la planilla se inserta como HTML.
   Todo se escribe con textContent / createElement (ver la función el()).
   Si alguien pega una etiqueta en una descripción, se ve como texto y no se ejecuta.
   ===================================================================== */
(function () {
  'use strict';

  const CFG = window.CONFIG_SITIO || {};
  const POR_PAGINA = CFG.productosPorPagina || 24;
  const CARPETA_FOTOS = CFG.carpetaFotos || 'fotos/';
  const TODAS = '__todas__';
  const CLAVE_PEDIDO = 'catalogo_pedido_v1';
  const CLAVE_CACHE = 'catalogo_cache_v1';
  const CLAVE_MAYORISTA = 'catalogo_mayorista_v1';
  const HORAS_CACHE_LOCAL = 24;

  const $ = id => document.getElementById(id);
  const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0, minimumFractionDigits: 0 });
  const plata = n => pesos.format(Math.round(n));

  const estado = {
    catalogo: null,
    porCodigo: {},
    categoria: TODAS,
    orden: 'destacados',
    busqueda: '',
    visibles: POR_PAGINA,
    pedido: leerPedido(),
    origen: calcularOrigen(),
    refWhatsapp: nuevaRef(),
    tituloBase: document.title,
    // Si se entró con un enlace a un producto (?p=P001) o a un grupo de opciones (?g=…), se abre cuando llega el catálogo.
    fichaPendiente: (() => {
      const q = new URLSearchParams(location.search);
      return q.get('p') ? { p: q.get('p') } : q.get('g') ? { g: q.get('g') } : null;
    })(),
    // Productos con opciones: { slug: { slug, nombre, variantes: [productos] } }
    grupos: {},
    padreDe: {}, // subcategoría → categoría grande
    // Mayorista que ingresó en este dispositivo: { sesion, nombre, datos: { escalas, monto_minimo, unidades_minimas } }
    mayorista: leerLocal(CLAVE_MAYORISTA),
    mayoristaMensaje: '',
  };
  const accionesPorCodigo = new Map();
  // Página individual abierta: qué producto (o grupo y opciones elegidas), dónde va su botón Agregar
  // y desde dónde se abrió.
  const ficha = { abierta: false, codigo: null, grupo: null, seleccion: {}, caja: null, origen: null };
  let altAvisado = false;

  // ------------------------------------------------------------------
  // Herramientas
  // ------------------------------------------------------------------

  // Crea un elemento sin usar innerHTML. Los textos van como texto, nunca como HTML.
  function el(etiqueta, props, hijos) {
    const nodo = document.createElement(etiqueta);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'texto') nodo.textContent = v;
      else if (k === 'clase') nodo.className = v;
      else if (k.startsWith('on')) nodo.addEventListener(k.slice(2), v);
      else nodo.setAttribute(k, v === true ? '' : v);
    });
    (hijos || []).forEach(h => { if (h !== null && h !== undefined && h !== false) nodo.append(h); });
    return nodo;
  }

  // Reemplaza el contenido de un nodo, salteando los vacíos (null/false), que si no se escribirían como "null".
  function poner(nodo, ...hijos) {
    nodo.replaceChildren(...hijos.filter(h => h !== null && h !== undefined && h !== false));
  }

  function normalizar(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function guardarLocal(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado o sin espacio: se sigue sin guardar */ }
  }
  function leerLocal(clave) {
    try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; }
  }

  function leerPedido() {
    const p = leerLocal(CLAVE_PEDIDO);
    return p && typeof p === 'object' ? p : {};
  }

  // De dónde vino el visitante: utm de la URL (ej. ?utm_source=instagram), o la página anterior.
  // Viaja en el mensaje de WhatsApp y en el formulario.
  function calcularOrigen() {
    try {
      const guardado = sessionStorage.getItem('catalogo_origen');
      if (guardado) return guardado;
    } catch (e) { /* sin sessionStorage */ }
    const p = new URLSearchParams(location.search);
    let origen = [p.get('utm_source'), p.get('utm_medium'), p.get('utm_campaign')].filter(Boolean).join(' / ');
    if (!origen && document.referrer) {
      try {
        const host = new URL(document.referrer).hostname;
        if (host && host !== location.hostname) origen = host;
      } catch (e) { /* referrer raro */ }
    }
    origen = (origen || 'directo').slice(0, 120);
    try { sessionStorage.setItem('catalogo_origen', origen); } catch (e) { /* sin sessionStorage */ }
    return origen;
  }

  // Referencia corta que viaja en el mensaje de WhatsApp y queda en la planilla, para encontrar el chat.
  function nuevaRef() {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const azar = new Uint8Array(5);
    (window.crypto || window.msCrypto).getRandomValues(azar);
    return 'W-' + Array.from(azar, n => letras[n % letras.length]).join('');
  }

  // Enlace a un producto. Completo (para compartir) o relativo (para la barra de direcciones).
  function urlProducto(codigo, relativa) {
    const q = '?p=' + encodeURIComponent(codigo);
    return relativa ? location.pathname + q : location.origin + location.pathname + q;
  }

  async function pedirJSON(url, opciones, ms) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ms);
    try {
      const r = await fetch(url, Object.assign({ signal: control.signal }, opciones));
      if (!r.ok) throw new Error('El servidor respondió ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(reloj);
    }
  }

  function negocio() {
    return (estado.catalogo && estado.catalogo.negocio) || {};
  }
  function whatsappNumero() {
    return negocio().whatsapp || String(CFG.whatsappRespaldo || '').replace(/\D/g, '');
  }
  function mostrarPrecios() {
    return !!(estado.catalogo && estado.catalogo.negocio && estado.catalogo.negocio.mostrar_precios);
  }
  // Enlace directo wa.me con el texto prellenado (sin acortadores: así el texto puede variar con cada pedido).
  function enlaceWhatsapp(texto) {
    return 'https://wa.me/' + whatsappNumero() + '?text=' + encodeURIComponent(texto);
  }

  // ------------------------------------------------------------------
  // Carga del catálogo
  // ------------------------------------------------------------------

  async function cargar() {
    const local = leerLocal(CLAVE_CACHE);
    const sirve = local && local.datos && Date.now() - local.guardado < HORAS_CACHE_LOCAL * 3600 * 1000;
    if (sirve) aplicarCatalogo(local.datos, true); // se muestra al instante y se actualiza abajo

    try {
      if (!CFG.urlScript) throw new Error('Falta la URL del script en config.js');
      const url = CFG.urlScript + (CFG.urlScript.includes('?') ? '&' : '?') + 'accion=catalogo';
      // cache: 'no-store': Google redirige cada pedido a una dirección de un solo uso. Si el navegador
      // guarda esa redirección, la próxima vez va a una dirección vencida y Google responde 404.
      // (No es una cabecera: no dispara la verificación previa de CORS.)
      const datos = await pedirJSON(url, { cache: 'no-store' }, 20000);
      if (!datos || !datos.ok || !Array.isArray(datos.productos)) throw new Error((datos && datos.error) || 'Respuesta inválida');
      guardarLocal(CLAVE_CACHE, { guardado: Date.now(), datos });
      aplicarCatalogo(datos, false);
    } catch (err) {
      console.error('No se pudo cargar el catálogo:', err);
      estado.fichaPendiente = null;
      if (sirve) {
        $('estado').textContent = 'No pudimos actualizar el catálogo: estás viendo la última versión guardada. Los precios se confirman al responder tu pedido.';
      } else {
        mostrarErrorCarga();
      }
    }
  }

  function mostrarErrorCarga() {
    const grilla = $('grilla');
    grilla.replaceChildren();
    grilla.setAttribute('aria-busy', 'false');
    const numero = whatsappNumero();
    poner($('estado'),
      el('span', { texto: 'No pudimos cargar el catálogo. Revisá tu conexión e intentá de nuevo.' }),
      el('br'),
      el('button', { type: 'button', clase: 'boton boton-primario', texto: 'Reintentar', onclick: () => { $('estado').textContent = 'Cargando catálogo…'; cargar(); } }),
      ' ',
      numero ? el('a', { clase: 'boton boton-whatsapp', href: enlaceWhatsapp('¡Hola! Quiero hacer una consulta.'), target: '_blank', rel: 'noopener', texto: 'Escribinos por WhatsApp' }) : null
    );
  }

  function aplicarCatalogo(datos, desdeCache) {
    estado.catalogo = datos;
    estado.porCodigo = {};
    estado.grupos = {};
    datos.productos.forEach(p => {
      estado.porCodigo[p.codigo] = p;
      // Filas con el mismo Grupo = un solo producto con opciones (cada opción conserva su código).
      if (p.grupo) {
        p.grupoSlug = slug(p.grupo);
        const g = estado.grupos[p.grupoSlug] || (estado.grupos[p.grupoSlug] = { slug: p.grupoSlug, nombre: p.grupo, variantes: [] });
        g.variantes.push(p);
      }
    });

    // El pedido guardado solo conserva productos que siguen en el catálogo.
    Object.keys(estado.pedido).forEach(c => { if (!estado.porCodigo[c]) delete estado.pedido[c]; });
    guardarLocal(CLAVE_PEDIDO, estado.pedido);

    if (estado.categoria !== TODAS && !datos.categorias.includes(estado.categoria)) estado.categoria = TODAS;
    // Subcategoría → su categoría grande (para filtrar y para mostrar "Grande › Sub").
    estado.padreDe = {};
    (datos.arbol || []).forEach(n => n.hijas.forEach(h => { estado.padreDe[h] = n.nombre; }));

    avisarFaltaDeAlt(datos.productos);
    pintarNegocio();
    pintarFiltros();
    pintarGrilla();
    pintarPedido();
    pintarMenu();
    pintarBarraMayorista();
    mostrarVista(false);

    // Enlace directo a un producto (?p=P001) o a un grupo (?g=…).
    if (estado.fichaPendiente) {
      const { p, g } = estado.fichaPendiente;
      if (p && estado.porCodigo[p]) {
        estado.fichaPendiente = null;
        abrirFicha(p, false);
      } else if (g && estado.grupos[g]) {
        estado.fichaPendiente = null;
        abrirGrupo(g, null, false);
      } else if (!desdeCache) {
        // Puede no estar en la copia guardada pero sí en la nueva: solo se avisa con la nueva.
        estado.fichaPendiente = null;
        history.replaceState(null, '', urlSinProducto());
        $('estado').textContent = 'El producto del enlace ya no está disponible. Mirá el resto del catálogo.';
      }
    } else if (ficha.abierta) {
      // Llegó una versión nueva del catálogo con la página de un producto abierta.
      repintarFicha();
    }
  }

  function slug(t) {
    return normalizar(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Texto alternativo obligatorio: si falta, se usa el nombre y se avisa en la consola.
  function avisarFaltaDeAlt(productos) {
    if (altAvisado) return;
    const sinAlt = productos.filter(p => !p.alt).map(p => p.codigo);
    if (sinAlt.length) {
      console.warn('Productos sin "Texto de la foto" en la planilla (se usa el nombre en su lugar): ' + sinAlt.join(', '));
      altAvisado = true;
    }
  }

  // Franja de avisos (texto_aviso en Configuración). Varios mensajes separados por | van rotando:
  // cada uno entra despacio desde la derecha, se queda unos segundos y sale por la izquierda.
  let relojAvisos = null;
  let avisosActuales = '';
  function pintarAvisos(texto) {
    const mensajes = String(texto || '').split(/\s*\|\s*|\n+/).map(s => s.trim()).filter(Boolean);
    if (mensajes.join('|') === avisosActuales) return; // mismo texto: no reiniciar la rotación
    avisosActuales = mensajes.join('|');
    const caja = $('aviso');
    clearInterval(relojAvisos);
    caja.hidden = !mensajes.length;
    caja.classList.toggle('aviso-rotativo', mensajes.length > 1);
    caja.replaceChildren(...mensajes.map((m, i) => el('span', {
      clase: 'aviso-mensaje' + (i === 0 ? ' activo' : ''), texto: m, 'aria-hidden': i === 0 ? null : 'true',
    })));
    if (mensajes.length < 2) return;

    let actual = 0;
    let frenado = false; // con el mouse encima, el mensaje se queda quieto para poder leerlo
    caja.onmouseenter = () => { frenado = true; };
    caja.onmouseleave = () => { frenado = false; };
    relojAvisos = setInterval(() => {
      if (frenado || document.hidden) return;
      const items = caja.children;
      const sale = items[actual];
      sale.classList.remove('activo');
      sale.classList.add('saliendo');
      sale.setAttribute('aria-hidden', 'true');
      setTimeout(() => sale.classList.remove('saliendo'), 2000);
      actual = (actual + 1) % items.length;
      items[actual].classList.add('activo');
      items[actual].removeAttribute('aria-hidden');
    }, (CFG.segundosPorAviso || 7) * 1000);
  }

  // Logo (si hay uno en config.js) o el nombre escrito. El logo se muestra apenas abre la página.
  function pintarMarca(nombre) {
    const marca = $('nombre-negocio');
    const actual = marca.querySelector('img');
    if (CFG.logo && actual) { actual.alt = nombre; return; }
    marca.replaceChildren(CFG.logo
      ? el('img', { src: CFG.logo, alt: nombre, clase: 'logo' + (CFG.logoEnBlanco ? ' logo-blanco' : '') })
      : nombre);
  }

  function pintarNegocio() {
    const n = negocio();
    const nombre = n.nombre_negocio || 'Catálogo';
    estado.tituloBase = nombre + ' — Catálogo';
    if (!ficha.codigo) document.title = estado.tituloBase;
    pintarMarca(nombre);
    $('pie-negocio').textContent = nombre;

    pintarAvisos(n.texto_aviso);

    const contacto = [];
    if (n.whatsapp) contacto.push(el('a', { href: enlaceWhatsapp('¡Hola! Quiero hacer una consulta.'), target: '_blank', rel: 'noopener', texto: 'WhatsApp' }));
    if (n.mail_pedidos) contacto.push(el('a', { href: 'mailto:' + n.mail_pedidos, texto: n.mail_pedidos }));
    $('pie-contacto').replaceChildren(...contacto.flatMap((c, i) => (i ? [' · ', c] : [c])));

    const select = $('f-pago');
    const opciones = String(n.formas_de_pago || '').split(',').map(s => s.trim()).filter(Boolean);
    const elegida = select.value;
    select.replaceChildren(el('option', { value: '', texto: 'A convenir' }), ...opciones.map(o => el('option', { value: o, texto: o })));
    if (opciones.includes(elegida)) select.value = elegida;
    select.closest('.campo').hidden = !opciones.length;

    // Aviso de privacidad junto al formulario.
    const contactoPrivacidad = [];
    if (n.mail_pedidos) contactoPrivacidad.push(el('a', { href: 'mailto:' + n.mail_pedidos, texto: n.mail_pedidos }));
    if (n.whatsapp) contactoPrivacidad.push(el('a', { href: enlaceWhatsapp('Hola, quiero consultar por mis datos personales.'), target: '_blank', rel: 'noopener', texto: 'WhatsApp' }));
    $('privacidad').replaceChildren(
      el('strong', { texto: 'Privacidad. ' }),
      `Tus datos (nombre, contacto y pedido) los recibe ${nombre} y se usan solo para responder y coordinar este pedido. ` +
      'Quedan guardados en el correo y en una planilla de Google del negocio. No se venden ni se ceden a terceros. ' +
      'Podés pedir acceso, corrección o eliminación de tus datos (Ley 25.326) escribiendo a ',
      ...contactoPrivacidad.flatMap((c, i) => (i ? [' o por ', c] : [c])),
      '.'
    );
  }

  // ------------------------------------------------------------------
  // Filtros y buscador
  // ------------------------------------------------------------------

  // Árbol de categorías: { nombre, hijas: [...] }. Si el catálogo no lo trae (versión vieja del script),
  // todas son categorías grandes.
  function arbolCategorias() {
    const c = estado.catalogo;
    return c.arbol || c.categorias.map(nombre => ({ nombre, hijas: [] }));
  }
  // ¿El producto está en esa categoría, o en una subcategoría de ella?
  function enCategoria(p, categoria) {
    return p.categoria === categoria || estado.padreDe[p.categoria] === categoria;
  }

  function pintarFiltros() {
    const arbol = arbolCategorias();
    const caja = $('filtros');
    $('categorias').hidden = estado.catalogo.categorias.length < 2;
    // Se cuentan tarjetas: un producto con opciones cuenta una sola vez; una grande suma sus subcategorías.
    const todas = tarjetasCatalogo();
    const cuenta = c => todas.filter(t => variantesDe(t).some(p => enCategoria(p, c))).length;
    const elegir = valor => {
      estado.categoria = valor;
      estado.visibles = POR_PAGINA;
      pintarFiltros(); // vuelve a dibujar para abrir o cerrar las subcategorías
      pintarGrilla();
      const boton = [...caja.querySelectorAll('.filtro')].find(b => b.dataset.valor === valor);
      if (boton) boton.focus();
    };
    const boton = (valor, texto, n, clase, extra) => el('button', Object.assign({
      type: 'button', clase: 'filtro ' + clase, 'data-valor': valor,
      'aria-pressed': String(estado.categoria === valor),
      onclick: () => elegir(valor),
    }, extra || {}), [el('span', { texto }), el('span', { clase: 'cantidad-categoria', texto: String(n) })]);

    const items = [boton(TODAS, 'Todos', todas.length, 'filtro-grande')];
    arbol.forEach(nodo => {
      // Las subcategorías se ven cuando está elegida su grande o una de ellas.
      const abierta = estado.categoria === nodo.nombre || nodo.hijas.includes(estado.categoria);
      items.push(boton(nodo.nombre, nodo.nombre, cuenta(nodo.nombre), 'filtro-grande' + (nodo.hijas.length ? ' con-hijas' : ''),
        nodo.hijas.length ? { 'aria-expanded': String(abierta) } : null));
      if (abierta) nodo.hijas.forEach(h => items.push(boton(h, h, cuenta(h), 'filtro-hija')));
    });
    caja.replaceChildren(...items);

    // Ordenar por precio solo tiene sentido si se muestran precios.
    $('campo-orden').hidden = !mostrarPrecios();
    if (!mostrarPrecios()) estado.orden = 'destacados';
    $('orden').value = estado.orden;
  }

  // Las tarjetas del catálogo, en el orden de la planilla: { p } = producto común, { g } = grupo con opciones.
  function tarjetasCatalogo() {
    const vistos = new Set();
    const res = [];
    estado.catalogo.productos.forEach(p => {
      if (!p.grupoSlug) { res.push({ p }); return; }
      if (vistos.has(p.grupoSlug)) return;
      vistos.add(p.grupoSlug);
      res.push({ g: estado.grupos[p.grupoSlug] });
    });
    return res;
  }
  function variantesDe(t) {
    return t.g ? t.g.variantes : [t.p];
  }
  // Precio más bajo de la tarjeta (en un grupo, la opción más barata).
  function precioMinimo(t, siFalta) {
    const precios = variantesDe(t).map(p => p.precio).filter(n => typeof n === 'number');
    return precios.length ? Math.min(...precios) : siFalta;
  }

  const ORDENES = {
    // destacados primero; el resto, en el orden de la planilla
    'destacados': (a, b) => Number(variantesDe(b).some(p => p.destacado)) - Number(variantesDe(a).some(p => p.destacado)),
    // sin precio ("Consultar") va al final en los dos órdenes por precio
    'precio-asc': (a, b) => precioMinimo(a, Infinity) - precioMinimo(b, Infinity),
    'precio-desc': (a, b) => precioMinimo(b, -Infinity) - precioMinimo(a, -Infinity),
  };

  function productosFiltrados() {
    const palabras = normalizar(estado.busqueda).split(' ').filter(Boolean);
    return tarjetasCatalogo()
      .filter(t => estado.categoria === TODAS || variantesDe(t).some(p => enCategoria(p, estado.categoria)))
      .filter(t => {
        if (!palabras.length) return true;
        const texto = normalizar(variantesDe(t).map(p => [p.nombre, p.grupo, p.descripcion, p.codigo, p.categoria,
          (p.opciones || []).map(o => o.valor).join(' ')].join(' ')).join(' '));
        return palabras.every(w => texto.includes(w));
      })
      .sort(ORDENES[estado.orden] || ORDENES.destacados);
  }

  // Cuántos filtros hay aplicados (se muestra en el botón "Categorías y orden" del celular).
  function pintarFiltrosActivos() {
    const n = (estado.categoria !== TODAS ? 1 : 0) + (estado.orden !== 'destacados' ? 1 : 0);
    const marca = $('filtros-activos');
    marca.hidden = !n;
    marca.textContent = String(n);
    $('abrir-filtros').setAttribute('aria-label', n ? `Categorías y orden, ${n} aplicado${n > 1 ? 's' : ''}` : 'Categorías y orden');
  }

  // La barra lateral: en computadora queda abierta en su lugar; en el celular se abre como panel.
  const ANCHO_BARRA_LATERAL = window.matchMedia('(min-width: 768px)'); // ⚠️ el mismo ancho que en estilos.css
  function acomodarBarraLateral() {
    const panel = $('filtros-panel');
    if (ANCHO_BARRA_LATERAL.matches) {
      if (panel.open && panel.matches(':modal')) panel.close();
      if (!panel.open) panel.show();
    } else if (panel.open && !panel.matches(':modal')) {
      panel.close();
    }
  }
  function abrirFiltros() {
    const panel = $('filtros-panel');
    if (ANCHO_BARRA_LATERAL.matches) return;
    if (panel.open) panel.close();
    panel.showModal();
    $('cerrar-filtros').focus();
  }
  function cerrarFiltros() {
    const panel = $('filtros-panel');
    if (ANCHO_BARRA_LATERAL.matches) return; // en computadora no se cierra
    const estabaAbierto = panel.open;
    if (estabaAbierto) panel.close();
    if (estabaAbierto) $('abrir-filtros').focus();
  }

  // ------------------------------------------------------------------
  // Grilla de productos
  // ------------------------------------------------------------------

  const TEXTO_ESTADO = { disponible: 'Disponible', ultimas: 'Últimas unidades', sin_stock: 'Sin stock' };

  function pintarGrilla() {
    pintarFiltrosActivos();
    const lista = productosFiltrados();
    $('aplicar-filtros').textContent = lista.length === 1 ? 'Ver 1 producto' : `Ver ${lista.length} productos`;
    const grilla = $('grilla');
    accionesPorCodigo.clear();
    grilla.replaceChildren(...lista.slice(0, estado.visibles).map((t, i) => (t.g ? tarjetaGrupo(t.g, i === 0) : tarjeta(t.p, i === 0))));
    grilla.setAttribute('aria-busy', 'false');

    const mensaje = $('estado');
    if (!estado.catalogo.productos.length) {
      mensaje.textContent = 'Todavía no hay productos cargados.';
    } else if (!lista.length) {
      mensaje.replaceChildren(
        el('span', { texto: estado.busqueda ? `No encontramos productos con "${estado.busqueda}". ` : 'No hay productos en esta categoría. ' }),
        el('button', { type: 'button', clase: 'boton boton-secundario', texto: 'Ver todos los productos', onclick: limpiarFiltros })
      );
    } else {
      mensaje.textContent = lista.length === 1 ? '1 producto' : `${lista.length} productos`;
    }

    const verMas = $('ver-mas');
    verMas.hidden = lista.length <= estado.visibles;
    verMas.textContent = `Ver más productos (${lista.length - Math.min(estado.visibles, lista.length)} más)`;
  }

  function limpiarFiltros() {
    estado.busqueda = '';
    estado.categoria = TODAS;
    estado.visibles = POR_PAGINA;
    $('buscador').value = '';
    pintarFiltros();
    pintarGrilla();
    cerrarFiltros();
    $('buscador').focus();
  }

  function fotoProducto(p, ansiosa) {
    const foto = el('img', {
      src: p.foto ? CARPETA_FOTOS + p.foto : CARPETA_FOTOS + 'sin-foto.svg',
      alt: p.alt || p.nombre,
      width: '600', height: '600',
      // La primera foto carga enseguida; el resto, recién cuando se acerca a la pantalla.
      loading: ansiosa ? 'eager' : 'lazy',
      fetchpriority: ansiosa ? 'high' : null,
      decoding: 'async',
    });
    foto.addEventListener('error', () => {
      if (!foto.src.endsWith('sin-foto.svg')) {
        console.warn(`Falta la foto ${CARPETA_FOTOS}${p.foto} (producto ${p.codigo}).`);
        foto.src = CARPETA_FOTOS + 'sin-foto.svg';
      }
    });
    return foto;
  }

  function etiquetasProducto(p) {
    return el('p', { clase: 'etiquetas' }, [
      p.destacado ? el('span', { clase: 'etiqueta etiqueta-destacado', texto: 'Destacado' }) : null,
      el('span', { clase: 'etiqueta etiqueta-' + p.estado, texto: TEXTO_ESTADO[p.estado] + (typeof p.cantidad === 'number' && p.estado !== 'sin_stock' ? ` · ${p.cantidad} u.` : '') }),
    ]);
  }

  // Enlace a la página del producto. Un clic normal la abre acá mismo;
  // con Ctrl o la rueda del mouse se abre en otra pestaña, como cualquier enlace.
  function enlaceProducto(p, hijos, props) {
    return el('a', Object.assign({
      href: urlProducto(p.codigo, true),
      onclick: ev => {
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button) return;
        ev.preventDefault();
        abrirFicha(p.codigo, true, ev.currentTarget);
      },
    }, props || {}), hijos);
  }

  function tarjeta(p, primera) {
    const accion = el('div', { clase: 'accion' });
    accionesPorCodigo.set(p.codigo, accion);
    pintarAccionEn(accion, p);

    return el('li', { clase: 'tarjeta' }, [
      // La foto es un segundo enlace al mismo lugar: se oculta del teclado y de los lectores para no repetir.
      enlaceProducto(p, [fotoProducto(p, primera)], { clase: 'foto', tabindex: '-1', 'aria-hidden': 'true' }),
      el('div', { clase: 'tarjeta-cuerpo' }, [
        etiquetasProducto(p),
        el('h2', {}, [enlaceProducto(p, [p.nombre], { clase: 'enlace-producto' })]),
        p.descripcion ? el('p', { clase: 'descripcion', texto: p.descripcion }) : null,
        precioTarjeta(p),
        lineaEscalas(p),
        lineaCuotas(p),
        accion,
      ]),
    ]);
  }

  // Enlace a la página de un producto con opciones (?g=grupo).
  function enlaceGrupo(g, hijos, props) {
    return el('a', Object.assign({
      href: urlGrupo(g.slug, true),
      onclick: ev => {
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button) return;
        ev.preventDefault();
        abrirGrupo(g.slug, null, true, ev.currentTarget);
      },
    }, props || {}), hijos);
  }

  // Tarjeta de un producto con opciones: "desde $X", qué opciones hay y "Elegir medida".
  function tarjetaGrupo(g, primera) {
    const vs = g.variantes;
    const base = vs.find(p => p.foto) || vs[0];
    const conStock = vs.filter(p => p.estado !== 'sin_stock');
    const estadoGrupo = !conStock.length ? 'sin_stock' : conStock.every(p => p.estado === 'ultimas') ? 'ultimas' : 'disponible';
    const nombres = caracteristicas(g);
    const precios = vs.map(p => p.precio).filter(n => typeof n === 'number');
    const minimo = precios.length ? Math.min(...precios) : null;
    const todosIguales = precios.length && precios.every(n => n === minimo);
    const hayEscalas = vs.some(p => (p.escalas || []).length || tramosMayoristas(p.codigo).length);

    let precio;
    if (!mostrarPrecios() || minimo === null) precio = el('p', { clase: 'precio', texto: 'Consultar precio' });
    else precio = el('p', { clase: 'precio' }, [todosIguales ? null : el('small', { texto: 'desde ' }), plata(minimo), ' ', el('small', { texto: 'contado' })].filter(Boolean));

    return el('li', { clase: 'tarjeta tarjeta-grupo' }, [
      enlaceGrupo(g, [fotoProducto(Object.assign({}, base, { nombre: g.nombre }), primera)], { clase: 'foto', tabindex: '-1', 'aria-hidden': 'true' }),
      el('div', { clase: 'tarjeta-cuerpo' }, [
        el('p', { clase: 'etiquetas' }, [
          vs.some(p => p.destacado) ? el('span', { clase: 'etiqueta etiqueta-destacado', texto: 'Destacado' }) : null,
          el('span', { clase: 'etiqueta etiqueta-' + estadoGrupo, texto: TEXTO_ESTADO[estadoGrupo] }),
        ]),
        el('h2', {}, [enlaceGrupo(g, [g.nombre], { clase: 'enlace-producto' })]),
        // Qué se puede elegir: "Medida: 1/2" · 3/4" · 1"" (la primera característica) y cuántas opciones hay.
        nombres.length ? el('p', { clase: 'opciones-resumen', texto: `${nombres[0]}: ${valoresDe(g, nombres[0]).join(' · ')}` }) : null,
        el('p', { clase: 'cantidad-opciones', texto: `${vs.length} opciones` }),
        precio,
        hayEscalas && mostrarPrecios() ? el('p', { clase: 'escala' + (datosMayorista() ? ' escala-mayorista' : '') }, [datosMayorista() ? 'Precios mayoristas por cantidad' : 'Descuentos por cantidad']) : null,
        el('div', { clase: 'accion' }, [
          el('button', {
            type: 'button', clase: 'boton boton-primario',
            texto: nombres.length === 1 ? 'Elegir ' + nombres[0].toLowerCase() : 'Elegir opciones',
            'aria-label': `Elegir opciones de ${g.nombre}`,
            onclick: ev => abrirGrupo(g.slug, null, true, ev.currentTarget),
          }),
        ]),
      ]),
    ]);
  }

  function precioTarjeta(p) {
    if (!mostrarPrecios() || typeof p.precio !== 'number') return el('p', { clase: 'precio', texto: 'Consultar precio' });
    return el('p', { clase: 'precio' }, [plata(p.precio), ' ', el('small', { texto: 'contado' })]);
  }

  function textoCuota(opcion) {
    const fin = (estado.catalogo.financiacion || []).find(f => f.cuotas === opcion.cuotas);
    const sinInteres = fin && !fin.recargo;
    return `${opcion.cuotas} cuotas${sinInteres ? ' sin interés' : ''} de ${plata(opcion.valor)}`;
  }

  // En la tarjeta: la opción con más cuotas.
  function lineaCuotas(p) {
    if (!mostrarPrecios() || !p.cuotas || !p.cuotas.length) return null;
    const opcion = p.cuotas.reduce((a, b) => (b.cuotas > a.cuotas ? b : a));
    return el('p', { clase: 'cuotas', texto: 'o ' + textoCuota(opcion) });
  }

  // En la tarjeta: el primer tramo de descuento (mayorista si ingresó y tiene, si no el de todos).
  function lineaEscalas(p) {
    if (!mostrarPrecios() || typeof p.precio !== 'number') return null;
    const may = tramosMayoristas(p.codigo);
    const tramo = may[0] || (p.escalas || [])[0];
    if (!tramo) return null;
    const esMay = !!may[0];
    return el('p', { clase: 'escala' + (esMay ? ' escala-mayorista' : '') },
      [`${esMay ? 'Mayorista: ' : ''}desde ${tramo.desde} u. ${plata(p.precio * (1 - tramo.descuento))} c/u (−${Math.round(tramo.descuento * 100)}%)`]);
  }

  // En la página del producto: la tabla completa de precios por cantidad.
  function tablaEscalas(p) {
    if (!mostrarPrecios() || typeof p.precio !== 'number') return null;
    const filas = [
      ...(p.escalas || []).map(t => ({ t, may: false })),
      ...tramosMayoristas(p.codigo).map(t => ({ t, may: true })),
    ];
    if (!filas.length) return null;
    return el('div', { clase: 'ficha-escalas' }, [
      el('h3', { texto: 'Precio por cantidad' }),
      el('ul', {}, filas.map(({ t, may }) => el('li', { clase: may ? 'escala-mayorista' : '' }, [
        `${may ? 'Mayorista, desde' : 'Desde'} ${t.desde} u.: `,
        el('strong', { texto: plata(p.precio * (1 - t.descuento)) + ' c/u' }),
        ` (−${Math.round(t.descuento * 100)}%)`,
      ]))),
    ]);
  }

  function maximo(p) {
    return typeof p.cantidad === 'number' ? Math.max(0, Math.min(99, p.cantidad)) : 99;
  }

  // Un producto puede tener su botón Agregar en la tarjeta y en su página individual a la vez.
  function cajasDe(codigo) {
    const cajas = [];
    if (accionesPorCodigo.has(codigo)) cajas.push(accionesPorCodigo.get(codigo));
    if (ficha.codigo === codigo && ficha.caja) cajas.push(ficha.caja);
    return cajas;
  }

  function pintarAccion(p, enfocar, cajaFoco) {
    cajasDe(p.codigo).forEach(caja => pintarAccionEn(caja, p, caja === cajaFoco ? enfocar : null));
  }

  function pintarAccionEn(caja, p, enfocar) {
    const cant = estado.pedido[p.codigo] || 0;
    if (p.estado === 'sin_stock') {
      caja.replaceChildren(el('button', { type: 'button', clase: 'boton boton-secundario', disabled: true, texto: 'Sin stock' }));
      return;
    }
    if (!cant) {
      const agregar = el('button', {
        type: 'button', clase: 'boton boton-primario', texto: 'Agregar',
        'aria-label': `Agregar ${p.nombre} al pedido`,
        onclick: () => cambiarCantidad(p.codigo, 1, 'mas', caja),
      });
      caja.replaceChildren(agregar);
      if (enfocar) agregar.focus();
      return;
    }
    const control = el('div', { clase: 'cantidad', role: 'group', 'aria-label': `Cantidad de ${p.nombre}` }, [
      el('button', { type: 'button', 'data-foco': 'menos', 'aria-label': `Quitar uno de ${p.nombre}`, texto: '−', onclick: () => cambiarCantidad(p.codigo, -1, 'menos', caja) }),
      el('output', { 'aria-live': 'polite', texto: String(cant) }),
      el('button', { type: 'button', 'data-foco': 'mas', 'aria-label': `Agregar uno de ${p.nombre}`, texto: '+', disabled: cant >= maximo(p), onclick: () => cambiarCantidad(p.codigo, 1, 'mas', caja) }),
    ]);
    caja.replaceChildren(control);
    if (enfocar) {
      const destino = control.querySelector(`[data-foco="${enfocar}"]`);
      (destino.disabled ? control.querySelector('[data-foco="menos"]') : destino).focus();
    }
  }

  function cambiarCantidad(codigo, delta, foco, caja) {
    const p = estado.porCodigo[codigo];
    if (!p) return;
    const nueva = Math.max(0, Math.min(maximo(p), (estado.pedido[codigo] || 0) + delta));
    if (nueva) estado.pedido[codigo] = nueva;
    else delete estado.pedido[codigo];
    guardarLocal(CLAVE_PEDIDO, estado.pedido);
    estado.refWhatsapp = nuevaRef(); // pedido distinto → referencia distinta
    pintarAccion(p, foco, caja);
    pintarPedido();
  }

  // ------------------------------------------------------------------
  // Página individual de un producto (?p=CÓDIGO) o de un producto con opciones (?g=grupo)
  // ------------------------------------------------------------------

  function urlSinProducto() {
    const q = new URLSearchParams(location.search);
    q.delete('p');
    q.delete('g');
    const resto = q.toString();
    return location.pathname + (resto ? '?' + resto : '') + location.hash;
  }

  function urlGrupo(slugGrupo, relativa) {
    const q = '?g=' + encodeURIComponent(slugGrupo);
    return relativa ? location.pathname + q : location.origin + location.pathname + q;
  }

  function abrirFicha(codigo, agregarAlHistorial, origen) {
    const p = estado.porCodigo[codigo];
    if (!p) return;
    // Una opción de un grupo se abre en la página del grupo, con esa opción ya elegida.
    if (p.grupoSlug) { abrirGrupo(p.grupoSlug, codigo, agregarAlHistorial, origen); return; }
    const dialogo = $('ficha');
    ficha.abierta = true;
    ficha.grupo = null;
    ficha.codigo = codigo;
    if (!dialogo.open) ficha.origen = origen || document.activeElement;
    pintarFicha(p);
    // La dirección cambia a ?p=CÓDIGO: se puede copiar, compartir, y el botón "atrás" cierra la página.
    if (agregarAlHistorial) history.pushState({ ficha: codigo }, '', urlProducto(codigo, true));
    if (!dialogo.open) dialogo.showModal();
    $('ficha-cuerpo').scrollTop = 0;
    $('cerrar-ficha').focus();
  }

  function repintarFicha() {
    if (ficha.grupo) {
      const g = estado.grupos[ficha.grupo];
      if (g) pintarFichaGrupo(g); else cerrarFicha();
    } else if (ficha.codigo) {
      const p = estado.porCodigo[ficha.codigo];
      if (p) pintarFicha(p); else cerrarFicha();
    }
  }

  function botonesCompartir(p, url, aviso) {
    return el('div', { clase: 'ficha-compartir' }, [
      el('button', { type: 'button', clase: 'boton boton-secundario', texto: 'Compartir', onclick: () => compartir(p, url, aviso) }),
      el('a', {
        clase: 'boton boton-secundario', target: '_blank', rel: 'noopener', texto: 'Consultar por WhatsApp',
        href: enlaceWhatsapp(`¡Hola! Quiero consultar por este producto: ${p.nombre}${p.codigo ? ' (' + p.codigo + ')' : ''}\n${url}`),
      }),
    ]);
  }

  function botonVerPedido() {
    const unidades = Object.values(estado.pedido).reduce((s, c) => s + c, 0);
    return el('button', {
      type: 'button', id: 'ficha-ver-pedido', clase: 'boton boton-primario ficha-ver-pedido',
      hidden: !unidades, texto: `Ver tu pedido (${unidades})`,
      onclick: () => { cerrarFicha(); abrirPanelPedido(); },
    });
  }

  function listaCuotas(p) {
    return mostrarPrecios() && p.cuotas && p.cuotas.length
      ? el('ul', { clase: 'ficha-cuotas' }, p.cuotas.map(o => el('li', { texto: textoCuota(o) })))
      : null;
  }

  function parrafos(texto) {
    // Cada salto de línea de la planilla es un párrafo (como texto, nunca como HTML).
    return String(texto || '').split(/\n+/).filter(Boolean).map(t => el('p', { clase: 'ficha-texto', texto: t }));
  }

  // "Termofusión › Válvulas" (o solo la categoría, si es grande).
  function migas(categoria) {
    return estado.padreDe[categoria] ? estado.padreDe[categoria] + ' › ' + categoria : categoria;
  }

  function pintarFicha(p) {
    const n = negocio();
    document.title = `${p.nombre} — ${n.nombre_negocio || 'Catálogo'}`;
    $('ficha-migas').textContent = migas(p.categoria);

    ficha.caja = el('div', { clase: 'accion' });
    pintarAccionEn(ficha.caja, p);
    const aviso = el('p', { clase: 'ficha-aviso', role: 'status' });

    $('ficha-cuerpo').replaceChildren(el('div', { clase: 'ficha-grilla' }, [
      el('div', { clase: 'ficha-foto' }, [fotoProducto(p, true)]),
      el('div', { clase: 'ficha-info' }, [
        etiquetasProducto(p),
        el('h2', { id: 'ficha-titulo', texto: p.nombre }),
        el('p', { clase: 'ficha-codigo', texto: 'Código ' + p.codigo }),
        ...parrafos(p.descripcion_larga || p.descripcion),
        precioTarjeta(p),
        listaCuotas(p),
        tablaEscalas(p),
        ficha.caja,
        botonesCompartir(p, urlProducto(p.codigo), aviso),
        aviso,
        botonVerPedido(),
      ]),
    ]));
  }

  // ---------- Productos con opciones ----------

  // Nombres de las características del grupo, en orden (ej. ["Medida", "Material"]).
  function caracteristicas(g) {
    const nombres = [];
    g.variantes.forEach(p => (p.opciones || []).forEach(o => { if (!nombres.includes(o.nombre)) nombres.push(o.nombre); }));
    return nombres;
  }
  function valorDe(p, nombre) {
    const o = (p.opciones || []).find(x => x.nombre === nombre);
    return o ? o.valor : '';
  }
  function valoresDe(g, nombre) {
    const valores = [];
    g.variantes.forEach(p => { const v = valorDe(p, nombre); if (v && !valores.includes(v)) valores.push(v); });
    return valores;
  }
  // ¿La opción coincide con todo lo elegido hasta ahora?
  function coincide(p, seleccion) {
    return Object.entries(seleccion).every(([nombre, valor]) => valorDe(p, nombre) === valor);
  }
  function varianteElegida(g) {
    const nombres = caracteristicas(g);
    if (!nombres.every(n => ficha.seleccion[n])) return null;
    return g.variantes.find(p => coincide(p, ficha.seleccion)) || null;
  }
  // Si a una característica le queda un solo valor posible, se elige sola.
  function autoelegir(g) {
    caracteristicas(g).forEach(nombre => {
      if (ficha.seleccion[nombre]) return;
      const posibles = new Set(g.variantes.filter(p => coincide(p, ficha.seleccion)).map(p => valorDe(p, nombre)).filter(Boolean));
      if (posibles.size === 1) ficha.seleccion[nombre] = [...posibles][0];
    });
  }

  function abrirGrupo(slugGrupo, codigoElegido, agregarAlHistorial, origen) {
    const g = estado.grupos[slugGrupo];
    if (!g) return;
    const dialogo = $('ficha');
    ficha.abierta = true;
    ficha.grupo = slugGrupo;
    ficha.seleccion = {};
    const pre = codigoElegido && g.variantes.find(p => p.codigo === codigoElegido);
    if (pre) (pre.opciones || []).forEach(o => { ficha.seleccion[o.nombre] = o.valor; });
    autoelegir(g);
    if (!dialogo.open) ficha.origen = origen || document.activeElement;
    pintarFichaGrupo(g);
    if (agregarAlHistorial) {
      history.pushState({ ficha: slugGrupo }, '', ficha.codigo ? urlProducto(ficha.codigo, true) : urlGrupo(slugGrupo, true));
    }
    if (!dialogo.open) dialogo.showModal();
    $('ficha-cuerpo').scrollTop = 0;
    $('cerrar-ficha').focus();
  }

  function elegirOpcion(g, nombre, valor) {
    const anterior = ficha.seleccion;
    ficha.seleccion = Object.assign({}, anterior, { [nombre]: valor });
    // Si esa combinación no existe, se conserva lo nuevo y lo anterior que siga siendo compatible.
    if (!g.variantes.some(p => coincide(p, ficha.seleccion))) {
      ficha.seleccion = { [nombre]: valor };
      Object.entries(anterior).forEach(([n, v]) => {
        if (n === nombre) return;
        const prueba = Object.assign({}, ficha.seleccion, { [n]: v });
        if (g.variantes.some(p => coincide(p, prueba))) ficha.seleccion = prueba;
      });
    }
    autoelegir(g);
    pintarFichaGrupo(g);
    // La dirección lleva a la opción elegida (para compartirla) o al grupo.
    history.replaceState(history.state, '', ficha.codigo ? urlProducto(ficha.codigo, true) : urlGrupo(g.slug, true));
    const boton = [...$('ficha-cuerpo').querySelectorAll('.chip')]
      .find(b => b.dataset.nombre === nombre && b.dataset.valor === valor);
    if (boton) boton.focus();
  }

  function pintarFichaGrupo(g) {
    const n = negocio();
    const nombres = caracteristicas(g);
    const elegida = varianteElegida(g);
    ficha.codigo = elegida ? elegida.codigo : null;
    const base = elegida || g.variantes.find(p => p.foto) || g.variantes[0];
    document.title = `${g.nombre} — ${n.nombre_negocio || 'Catálogo'}`;
    $('ficha-migas').textContent = migas(base.categoria);

    // Botones de cada característica. Un valor que no combina con lo ya elegido se ve con borde punteado:
    // si se toca, cambia la otra elección.
    const selectores = nombres.map(nombre => el('fieldset', { clase: 'selector-opcion' }, [
      el('legend', { texto: nombre }),
      el('div', { clase: 'chips' }, valoresDe(g, nombre).map(valor => {
        const otras = Object.assign({}, ficha.seleccion);
        delete otras[nombre];
        const combina = g.variantes.some(p => valorDe(p, nombre) === valor && coincide(p, otras));
        const sinStock = g.variantes.filter(p => valorDe(p, nombre) === valor && coincide(p, otras)).every(p => p.estado === 'sin_stock');
        return el('button', {
          type: 'button', clase: 'chip' + (combina ? '' : ' chip-otra') + (combina && sinStock ? ' chip-sin-stock' : ''),
          'aria-pressed': String(ficha.seleccion[nombre] === valor),
          'aria-label': `${nombre}: ${valor}${combina ? (sinStock ? ' (sin stock)' : '') : ' (cambia la otra elección)'}`,
          'data-nombre': nombre, 'data-valor': valor, texto: valor,
          onclick: () => elegirOpcion(g, nombre, valor),
        });
      })),
    ]));

    const aviso = el('p', { clase: 'ficha-aviso', role: 'status' });
    let detalle;
    if (elegida) {
      ficha.caja = el('div', { clase: 'accion' });
      pintarAccionEn(ficha.caja, elegida);
      detalle = [
        etiquetasProducto(elegida),
        el('p', { clase: 'ficha-codigo', texto: 'Código ' + elegida.codigo }),
        precioTarjeta(elegida),
        listaCuotas(elegida),
        tablaEscalas(elegida),
        ficha.caja,
      ];
    } else {
      ficha.caja = null;
      const faltan = nombres.filter(x => !ficha.seleccion[x]).map(x => x.toLowerCase());
      const minimo = precioMinimo({ g }, null);
      detalle = [
        mostrarPrecios() && minimo !== null ? el('p', { clase: 'precio' }, [el('small', { texto: 'desde ' }), plata(minimo), ' ', el('small', { texto: 'contado' })]) : null,
        el('p', { clase: 'ayuda-opcion', texto: `Elegí ${faltan.join(' y ')} para ver el precio y agregarlo.` }),
        el('div', { clase: 'accion' }, [el('button', { type: 'button', clase: 'boton boton-secundario', disabled: true, texto: 'Elegí una opción' })]),
      ];
    }

    $('ficha-cuerpo').replaceChildren(el('div', { clase: 'ficha-grilla' }, [
      el('div', { clase: 'ficha-foto' }, [fotoProducto(base, true)]),
      el('div', { clase: 'ficha-info' }, [
        el('h2', { id: 'ficha-titulo', texto: g.nombre }),
        ...parrafos(base.descripcion_larga || base.descripcion),
        ...selectores,
        ...detalle,
        botonesCompartir(elegida || { nombre: g.nombre }, elegida ? urlProducto(elegida.codigo) : urlGrupo(g.slug), aviso),
        aviso,
        botonVerPedido(),
      ]),
    ]));
  }

  async function compartir(p, url, aviso) {
    if (navigator.share) {
      try {
        await navigator.share({ title: p.nombre, text: `${p.nombre} — ${negocio().nombre_negocio || ''}`.trim(), url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // la persona cerró el menú de compartir
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      aviso.textContent = 'Enlace copiado. Pegalo donde quieras compartirlo.';
    } catch (err) {
      aviso.textContent = 'Copiá este enlace: ' + url;
    }
  }

  // Se cierra siempre por acá (✕, Escape, clic en el fondo, botón "atrás"), sin depender del evento
  // "close" del navegador, que no todos los navegadores disparan a tiempo.
  function cerrarFicha() {
    const dialogo = $('ficha');
    if (dialogo.open) dialogo.close();
    alCerrarFicha();
  }

  function alCerrarFicha() {
    if (!ficha.abierta) return; // ya estaba cerrada
    ficha.abierta = false;
    ficha.codigo = null;
    ficha.grupo = null;
    ficha.seleccion = {};
    ficha.caja = null;
    document.title = estado.tituloBase;
    const q = new URLSearchParams(location.search);
    if (q.has('p') || q.has('g')) {
      // Si la página se abrió desde el catálogo, "atrás" vuelve a la dirección anterior; si se entró
      // directo con el enlace, se limpia la dirección sin salir del sitio.
      if (history.state && history.state.ficha) history.back();
      else history.replaceState(null, '', urlSinProducto());
    }
    const volver = ficha.origen && ficha.origen.isConnected ? ficha.origen : $('buscador');
    if (volver && !$('panel-pedido').open) volver.focus();
    ficha.origen = null;
  }

  // Botón "atrás" / "adelante" del navegador.
  function alCambiarHistorial() {
    const q = new URLSearchParams(location.search);
    const codigo = q.get('p');
    const grupo = q.get('g');
    mostrarVista(false);
    if (codigo && estado.porCodigo[codigo]) abrirFicha(codigo, false);
    else if (grupo && estado.grupos[grupo]) abrirGrupo(grupo, null, false);
    else if (!codigo && !grupo) cerrarFicha();
  }

  // ------------------------------------------------------------------
  // Secciones del menú (hoja "Páginas" de la planilla): ?pagina=contacto
  // ------------------------------------------------------------------

  function paginas() {
    return (estado.catalogo && estado.catalogo.paginas) || [];
  }
  function claveDePagina() {
    return new URLSearchParams(location.search).get('pagina') || '';
  }
  function urlPagina(clave) {
    return location.pathname + (clave ? '?pagina=' + encodeURIComponent(clave) : '');
  }

  // El mismo menú va en tres lugares: arriba (computadora), el panel "Menú" (celular) y el pie.
  function pintarMenu() {
    const lista = paginas();
    const actual = claveDePagina();
    const enlaces = () => [
      enlaceSeccion('', 'Catálogo', !actual),
      ...lista.map(p => enlaceSeccion(p.clave, p.menu, p.clave === actual)),
    ];
    $('menu').replaceChildren(...(lista.length ? enlaces() : []));
    $('menu-movil-lista').replaceChildren(...enlaces());
    $('pie-menu').replaceChildren(...(lista.length ? enlaces() : []));
    $('abrir-menu').hidden = !lista.length;
  }

  function enlaceSeccion(clave, texto, actual) {
    return el('a', {
      href: urlPagina(clave), texto,
      'aria-current': actual ? 'page' : null,
      onclick: ev => {
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button) return; // abrir en otra pestaña
        ev.preventDefault();
        irASeccion(clave);
      },
    });
  }

  function irASeccion(clave) {
    cerrarMenu(false);
    if (location.search !== new URL(urlPagina(clave), location.href).search) {
      history.pushState({ pagina: clave }, '', urlPagina(clave));
    }
    mostrarVista(true);
  }

  // Muestra el catálogo o la sección que pide la dirección.
  function mostrarVista(enfocar) {
    const clave = claveDePagina();
    const pagina = paginas().find(p => p.clave === clave);
    const enPagina = !!clave && (!!pagina || !estado.catalogo); // sin catálogo todavía: "Cargando…"
    $('vista-catalogo').hidden = enPagina;
    $('vista-pagina').hidden = !enPagina;
    if (enPagina) {
      if (pagina) pintarPagina(pagina);
      else $('vista-pagina').replaceChildren(el('p', { clase: 'estado', role: 'status', texto: 'Cargando…' }));
      document.title = (pagina ? pagina.titulo + ' — ' : '') + (negocio().nombre_negocio || 'Catálogo');
    } else if (!ficha.codigo) {
      document.title = estado.tituloBase;
      // Una sección que ya no existe (desactivada en la planilla) → se muestra el catálogo.
      if (clave && estado.catalogo) history.replaceState(null, '', urlPagina(''));
    }
    if (estado.catalogo) pintarMenu();
    if (enfocar) {
      window.scrollTo(0, 0);
      const titulo = enPagina ? $('pagina-titulo') : document.querySelector('#vista-catalogo .titulo');
      if (titulo) {
        titulo.setAttribute('tabindex', '-1');
        titulo.focus({ preventScroll: true });
      }
    }
  }

  function pintarPagina(pagina) {
    const esPreguntas = pagina.clave === 'preguntas-frecuentes';
    const cuerpo = [];
    textoABloques(pagina.texto).forEach(b => {
      if (b.titulo && esPreguntas) {
        cuerpo.push(el('details', { clase: 'pregunta' }, [el('summary', { texto: b.titulo }), el('div', { clase: 'respuesta' }, b.nodos)]));
      } else {
        if (b.titulo) cuerpo.push(el('h2', { texto: b.titulo }));
        cuerpo.push(...b.nodos);
      }
    });

    const n = negocio();
    const botones = [];
    if (pagina.clave === 'contacto') {
      if (n.whatsapp) botones.push(el('a', { clase: 'boton boton-whatsapp', href: enlaceWhatsapp('¡Hola! Quiero hacer una consulta.'), target: '_blank', rel: 'noopener', texto: 'Escribinos por WhatsApp' }));
      if (n.mail_pedidos) botones.push(el('a', { clase: 'boton boton-secundario', href: 'mailto:' + n.mail_pedidos, texto: 'Mandanos un mail' }));
    }
    botones.push(enlaceSeccionBoton());

    $('vista-pagina').replaceChildren(
      el('h1', { clase: 'titulo', id: 'pagina-titulo', texto: pagina.titulo }),
      ...cuerpo,
      el('div', { clase: 'botones-pagina' }, botones)
    );
  }

  function enlaceSeccionBoton() {
    const a = enlaceSeccion('', 'Ver el catálogo', false);
    a.className = 'boton boton-primario';
    return a;
  }

  // Convierte el texto de la planilla en párrafos, subtítulos (##) y listas (-). Todo como TEXTO, nunca HTML.
  function textoABloques(texto) {
    const bloques = [{ titulo: null, nodos: [] }];
    const actual = () => bloques[bloques.length - 1];
    let parrafo = [];
    let lista = null;
    const cerrarParrafo = () => {
      if (!parrafo.length) return;
      actual().nodos.push(el('p', {}, parrafo.flatMap((linea, i) => (i ? [el('br'), ...conEnlaces(linea)] : conEnlaces(linea)))));
      parrafo = [];
    };
    const cerrarLista = () => {
      if (lista) actual().nodos.push(lista);
      lista = null;
    };
    String(texto || '').split(/\r?\n/).forEach(linea => {
      const t = linea.trim();
      if (!t) { cerrarParrafo(); cerrarLista(); return; }
      if (t.startsWith('## ')) {
        cerrarParrafo(); cerrarLista();
        bloques.push({ titulo: t.slice(3).trim(), nodos: [] });
        return;
      }
      if (/^[-•] /.test(t)) {
        cerrarParrafo();
        if (!lista) lista = el('ul');
        lista.append(el('li', {}, conEnlaces(t.slice(2).trim())));
        return;
      }
      cerrarLista();
      parrafo.push(t);
    });
    cerrarParrafo();
    cerrarLista();
    return bloques.filter(b => b.titulo || b.nodos.length);
  }

  // Las direcciones https://… del texto se vuelven enlaces (solo http y https).
  function conEnlaces(texto) {
    return String(texto).split(/(https?:\/\/[^\s<>"]+)/g).filter(Boolean).flatMap(parte => {
      if (!/^https?:\/\//.test(parte)) return [parte];
      const url = parte.replace(/[.,;:!?)]+$/, '');
      const resto = parte.slice(url.length);
      return [el('a', { href: url, target: '_blank', rel: 'noopener', texto: url }), resto].filter(Boolean);
    });
  }

  function abrirMenu() {
    $('menu-movil').showModal();
    const destino = $('menu-movil-lista').querySelector('[aria-current]') || $('menu-movil-lista').querySelector('a');
    if (destino) destino.focus();
  }
  function cerrarMenu(volverFoco) {
    const menu = $('menu-movil');
    if (!menu.open) return;
    menu.close();
    if (volverFoco) $('abrir-menu').focus();
  }

  // ------------------------------------------------------------------
  // Precios por cantidad (escalas) — la misma cuenta que hace el script (Codigo.gs, armarDetalle_).
  // Acá es solo para mostrarla: el precio que vale lo calcula el script al recibir el pedido.
  // ------------------------------------------------------------------

  function precioConEscalas(precio, cantidad, tramosTodos, tramosMayoristas) {
    let descuento = 0;
    let mayorista = false;
    (tramosTodos || []).forEach(t => { if (cantidad >= t.desde && t.descuento > descuento) descuento = t.descuento; });
    (tramosMayoristas || []).forEach(t => {
      if (cantidad >= t.desde && t.descuento > descuento) { descuento = t.descuento; mayorista = true; }
    });
    return { unitario: Math.round(precio * (1 - descuento)), descuento, mayorista };
  }

  // Datos del mayorista que ingresó (escalas y mínimos), o null.
  function datosMayorista() {
    return estado.mayorista && estado.mayorista.datos && negocio().mayoristas ? estado.mayorista.datos : null;
  }

  // Escalas mayoristas de un producto, ya ajustadas a las unidades mínimas.
  function tramosMayoristas(codigo) {
    const may = datosMayorista();
    if (!may || !may.escalas || !may.escalas[codigo]) return [];
    return may.escalas[codigo].map(t => ({ desde: Math.max(t.desde, may.unidades_minimas || 0), descuento: t.descuento }));
  }

  function evaluarPedido() {
    const may = datosMayorista();
    const items = Object.entries(estado.pedido).filter(([c]) => estado.porCodigo[c]);
    const calcular = usarMayorista => {
      const lineas = items.map(([codigo, cantidad]) => {
        const p = estado.porCodigo[codigo];
        if (!mostrarPrecios() || typeof p.precio !== 'number') {
          return { p, cantidad, unitario: null, descuento: 0, mayorista: false, subtotal: null };
        }
        const tramosMay = usarMayorista && cantidad >= (may.unidades_minimas || 0) ? (may.escalas[codigo] || []) : [];
        const r = precioConEscalas(p.precio, cantidad, p.escalas, tramosMay);
        return { p, cantidad, unitario: r.unitario, descuento: r.descuento, mayorista: r.mayorista, subtotal: r.unitario * cantidad };
      });
      return { lineas, total: lineas.every(l => l.subtotal !== null) ? lineas.reduce((s, l) => s + l.subtotal, 0) : null };
    };
    let r = calcular(!!may);
    r.faltante = 0;
    if (may && may.monto_minimo && r.total !== null && r.total < may.monto_minimo) {
      const faltante = may.monto_minimo - r.total;
      r = calcular(false);
      r.faltante = faltante;
    }
    r.mayoristaAplicado = !!may && !r.faltante && r.lineas.some(l => l.mayorista);
    return r;
  }

  function textoDescuento(l) {
    return l.descuento ? ` (−${Math.round(l.descuento * 100)}%${l.mayorista ? ' mayorista' : ''})` : '';
  }

  // ------------------------------------------------------------------
  // Pedido
  // ------------------------------------------------------------------

  function lineasPedido() {
    return evaluarPedido().lineas;
  }

  function totalPedido(lineas) {
    return lineas.every(l => l.subtotal !== null) ? lineas.reduce((s, l) => s + l.subtotal, 0) : null;
  }

  function pintarPedido() {
    const ev = evaluarPedido();
    const lineas = ev.lineas;
    const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
    $('contador').textContent = String(unidades);
    $('contador-lectores').textContent = unidades ? `, ${unidades} ${unidades === 1 ? 'producto' : 'productos'}` : ', vacío';
    const verPedido = $('ficha-ver-pedido');
    if (verPedido) {
      verPedido.hidden = !unidades;
      verPedido.textContent = `Ver tu pedido (${unidades})`;
    }

    const hay = lineas.length > 0;
    $('pedido-vacio').hidden = hay || !$('confirmacion').hidden;
    $('pedido-contenido').hidden = !hay;
    if (!hay) return;

    const may = datosMayorista();
    $('lineas').replaceChildren(...lineas.map(l => {
      const { p, cantidad, subtotal } = l;
      // Si es mayorista y a este producto le faltan unidades para su precio, se lo dice.
      const minimo = may && may.unidades_minimas && (may.escalas[p.codigo] || []).length && cantidad < may.unidades_minimas
        ? `Precio mayorista desde ${may.unidades_minimas} u.` : '';
      return el('li', { clase: 'linea' }, [
        el('div', {}, [
          el('div', { clase: 'linea-nombre', texto: p.nombre }),
          el('div', { clase: 'linea-detalle', texto: `${p.codigo}${subtotal !== null ? ' · ' + plata(l.unitario) + ' c/u' + textoDescuento(l) : ''}${p.estado === 'sin_stock' ? ' · sin stock' : ''}` }),
          minimo ? el('div', { clase: 'linea-aviso', texto: minimo }) : null,
        ]),
        el('div', { clase: 'linea-subtotal', texto: subtotal !== null ? plata(subtotal) : '' }),
        el('div', { clase: 'cantidad', role: 'group', 'aria-label': `Cantidad de ${p.nombre}` }, [
          el('button', { type: 'button', 'aria-label': `Quitar uno de ${p.nombre}`, texto: '−', onclick: () => cambiarEnPanel(p.codigo, -1) }),
          el('output', { texto: String(cantidad) }),
          el('button', { type: 'button', 'aria-label': `Agregar uno de ${p.nombre}`, texto: '+', disabled: cantidad >= maximo(p), onclick: () => cambiarEnPanel(p.codigo, 1) }),
          el('button', { type: 'button', clase: 'quitar', texto: 'Quitar', 'aria-label': `Quitar ${p.nombre} del pedido`, onclick: () => cambiarEnPanel(p.codigo, -cantidad) }),
        ]),
      ]);
    }));

    const total = ev.total;
    const totales = $('totales');
    if (total === null) {
      totales.replaceChildren(el('p', { clase: 'nota', texto: 'Te respondemos con el precio y la disponibilidad.' }));
    } else {
      const opciones = (estado.catalogo.financiacion || []).map(f => el('li', {
        texto: `${f.cuotas} cuotas${f.recargo ? '' : ' sin interés'} de ${plata(total * (1 + f.recargo) / f.cuotas)}` +
          (f.recargo ? ` (total ${plata(total * (1 + f.recargo))})` : ''),
      }));
      poner(totales,
        ev.faltante ? el('p', { clase: 'aviso-minimo', role: 'status', texto:
          `Te faltan ${plata(ev.faltante)} para el mínimo mayorista (${plata(datosMayorista().monto_minimo)}). Mientras tanto, el pedido se calcula con precios minoristas.` }) : null,
        el('div', { clase: 'total' }, [
          el('span', { texto: ev.mayoristaAplicado ? 'Total mayorista contado' : 'Total contado' }),
          el('span', { texto: plata(total) }),
        ]),
        opciones.length ? el('ul', {}, opciones) : null,
        el('p', { clase: 'nota', texto: 'Los precios y la disponibilidad se confirman al responder tu pedido.' })
      );
    }
    $('enviar-whatsapp').href = enlaceWhatsapp(mensajePedido(null, estado.refWhatsapp));
  }

  // El cliente tocó "Enviar por WhatsApp": además de abrir WhatsApp, se anota el pedido en la planilla
  // (canal WhatsApp, con la misma referencia que va en el mensaje). No espera respuesta: WhatsApp se abre igual.
  function registrarWhatsapp() {
    const lineas = lineasPedido();
    if (!lineas.length || !CFG.urlScript) return;
    const cuerpo = JSON.stringify({
      tipo: 'whatsapp',
      ref: estado.refWhatsapp,
      origen: estado.origen,
      nombre: $('f-nombre').value.trim(),
      sesion: sesionMayorista(),
      items: lineas.map(l => ({ codigo: l.p.codigo, cantidad: l.cantidad })),
    });
    // ⚠️ Igual que en enviarFormulario: texto plano, SIN cabeceras. sendBeacon manda el aviso
    // aunque el navegador pase a WhatsApp y cierre la página; si no está disponible, fetch con keepalive.
    let enviado = false;
    try { enviado = navigator.sendBeacon(CFG.urlScript, cuerpo); } catch (err) { enviado = false; }
    if (!enviado) fetch(CFG.urlScript, { method: 'POST', body: cuerpo, keepalive: true }).catch(() => {});
  }

  // Cambiar cantidades desde el panel mantiene el foco en un lugar lógico.
  function cambiarEnPanel(codigo, delta) {
    const lista = $('lineas');
    const indice = [...lista.children].findIndex(li => li.contains(document.activeElement));
    const boton = document.activeElement && document.activeElement.getAttribute('aria-label') || '';
    cambiarCantidad(codigo, delta);
    const fila = lista.children[Math.min(indice, lista.children.length - 1)];
    const mismo = fila && [...fila.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === boton && !b.disabled);
    if (mismo) mismo.focus();
    else if (fila) fila.querySelector('button').focus();
    else $('cerrar-pedido').focus();
  }

  function mensajePedido(datosCliente, ref) {
    const ev = evaluarPedido();
    const partes = [ev.mayoristaAplicado ? '¡Hola! Quiero hacer este pedido MAYORISTA:' : '¡Hola! Quiero hacer este pedido:', ''];
    ev.lineas.forEach(l => {
      let linea = `• ${l.cantidad} × ${l.p.nombre} (${l.p.codigo})`;
      if (l.subtotal !== null && l.descuento) linea += ` — ${plata(l.unitario)} c/u${textoDescuento(l)} = ${plata(l.subtotal)}`;
      else if (l.subtotal !== null) linea += ' — ' + plata(l.subtotal);
      partes.push(linea);
    });
    if (ev.total !== null) partes.push('', `Total contado: ${plata(ev.total)}`);
    const may = datosMayorista();
    if (may) partes.push(`Cliente mayorista: ${estado.mayorista.nombre || ''}`.trim());
    if (datosCliente) {
      partes.push('', `Nombre: ${datosCliente.nombre}`);
      if (datosCliente.pago) partes.push(`Forma de pago: ${datosCliente.pago}`);
      if (datosCliente.comentarios) partes.push(`Comentarios: ${datosCliente.comentarios}`);
    }
    partes.push('', `(Pedido web${ref ? ' · Ref. ' + ref : ''} · origen: ${estado.origen})`);
    return partes.join('\n');
  }

  // ------------------------------------------------------------------
  // Mayoristas
  //  1. "¿Sos mayorista? Ingresá" → deja sus datos → el script le manda un enlace por mail.
  //  2. Al abrir el enlace (?acceso=…), el sitio lo canjea por una sesión firmada por el script.
  //  3. Con la sesión, el script entrega sus escalas; los pedidos la llevan y el script calcula el precio.
  // ------------------------------------------------------------------

  function sesionMayorista() {
    return (estado.mayorista && estado.mayorista.sesion) || '';
  }

  function postScript(cuerpo, ms) {
    // ⚠️ Texto plano, SIN cabeceras (ver enviarFormulario).
    return pedirJSON(CFG.urlScript, { method: 'POST', body: JSON.stringify(cuerpo) }, ms || 30000);
  }

  function pintarBarraMayorista() {
    const barra = $('barra-mayorista');
    const activo = !!(estado.catalogo && negocio().mayoristas);
    barra.hidden = !activo && !estado.mayoristaMensaje;
    if (barra.hidden) return;
    const hijos = [];
    if (estado.mayoristaMensaje) hijos.push(el('p', { clase: 'mayorista-mensaje', role: 'status', texto: estado.mayoristaMensaje }));
    if (activo && estado.mayorista && estado.mayorista.sesion) {
      const d = estado.mayorista.datos || {};
      const condiciones = [];
      if (d.monto_minimo) condiciones.push(`pedido mínimo ${plata(d.monto_minimo)}`);
      if (d.unidades_minimas) condiciones.push(`desde ${d.unidades_minimas} u. por producto`);
      hijos.push(el('p', {}, [
        el('strong', { texto: 'Precios mayoristas activos' }),
        estado.mayorista.nombre ? ` · ${estado.mayorista.nombre}` : '',
        condiciones.length ? ` · ${condiciones.join(' · ')}` : '',
        ' ',
        el('button', { type: 'button', clase: 'enlace-boton', texto: 'Salir', onclick: salirMayorista }),
      ]));
    } else if (activo) {
      hijos.push(el('p', {}, [
        '¿Sos mayorista? ',
        el('button', { type: 'button', clase: 'enlace-boton', texto: 'Ingresá para ver tus precios', onclick: abrirIngresoMayorista }),
      ]));
    }
    barra.replaceChildren(...hijos);
  }

  function guardarMayorista(m) {
    estado.mayorista = m;
    if (m) guardarLocal(CLAVE_MAYORISTA, m);
    else { try { localStorage.removeItem(CLAVE_MAYORISTA); } catch (e) { /* sin localStorage */ } }
  }

  function refrescarVistaPrecios() {
    pintarBarraMayorista();
    if (!estado.catalogo) return;
    pintarGrilla();
    pintarPedido();
    if (ficha.abierta) repintarFicha();
  }

  // Pide al script las escalas del mayorista (cada vez que abre el sitio, por si cambiaron).
  async function cargarDatosMayorista() {
    if (!sesionMayorista() || !CFG.urlScript) return;
    try {
      const r = await postScript({ tipo: 'mayorista_datos', sesion: sesionMayorista() }, 20000);
      if (r && r.ok) {
        guardarMayorista(Object.assign({}, estado.mayorista, {
          nombre: r.nombre || estado.mayorista.nombre,
          datos: { escalas: r.escalas || {}, monto_minimo: r.monto_minimo || 0, unidades_minimas: r.unidades_minimas || 0 },
        }));
      } else if (r && r.sesion_invalida) {
        guardarMayorista(null);
        estado.mayoristaMensaje = 'Tu acceso mayorista venció o fue dado de baja. Podés pedir uno nuevo.';
      }
    } catch (err) {
      console.warn('No se pudieron actualizar los precios mayoristas:', err);
    }
    refrescarVistaPrecios();
  }

  // El mayorista abrió el enlace del mail: ?acceso=…
  async function canjearAcceso(token) {
    history.replaceState(null, '', (() => {
      const q = new URLSearchParams(location.search);
      q.delete('acceso');
      const resto = q.toString();
      return location.pathname + (resto ? '?' + resto : '') + location.hash;
    })());
    estado.mayoristaMensaje = 'Validando tu acceso mayorista…';
    pintarBarraMayorista();
    try {
      const r = await postScript({ tipo: 'mayorista_validar', token }, 20000);
      if (!r || !r.ok) throw new Error((r && r.error) || 'No se pudo validar el acceso.');
      guardarMayorista({ sesion: r.sesion, nombre: r.nombre || '' });
      estado.mayoristaMensaje = `¡Listo${r.nombre ? ', ' + r.nombre : ''}! Ya ves tus precios mayoristas.`;
      await cargarDatosMayorista();
      // La bienvenida se va sola; quedan las condiciones y "Salir".
      setTimeout(() => { estado.mayoristaMensaje = ''; pintarBarraMayorista(); }, 8000);
    } catch (err) {
      estado.mayoristaMensaje = err.message === 'Failed to fetch' ? 'No se pudo validar el acceso. Revisá tu conexión y abrí el enlace de nuevo.' : err.message;
      refrescarVistaPrecios();
    }
  }

  function salirMayorista() {
    guardarMayorista(null);
    estado.mayoristaMensaje = '';
    refrescarVistaPrecios();
    $('buscador').focus();
  }

  function abrirIngresoMayorista() {
    $('formulario-mayorista').hidden = false;
    $('mayorista-enviado').hidden = true;
    $('error-mayorista').hidden = true;
    $('dialogo-mayorista').showModal();
    $('m-nombre').focus();
  }
  function cerrarIngresoMayorista() {
    const d = $('dialogo-mayorista');
    if (d.open) d.close();
  }

  async function enviarIngresoMayorista(ev) {
    ev.preventDefault();
    const f = $('formulario-mayorista');
    const datos = {
      tipo: 'mayorista_acceso',
      nombre: f.elements.nombre.value.trim(),
      telefono: f.elements.telefono.value.trim(),
      mail: f.elements.mail.value.trim(),
      consentimiento: f.elements.consentimiento.checked,
      sitio_web: f.elements.sitio_web.value,
    };
    const errores = {
      nombre: datos.nombre ? '' : 'Escribí tu nombre o razón social.',
      mail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.mail) ? '' : 'Escribí un mail válido: ahí te llega el enlace.',
      consentimiento: datos.consentimiento ? '' : 'Para continuar, marcá que aceptás.',
    };
    Object.entries(errores).forEach(([k, m]) => {
      $('m-' + k).setAttribute('aria-invalid', m ? 'true' : 'false');
      $('em-' + k).textContent = m;
      $('em-' + k).hidden = !m;
    });
    const primero = Object.keys(errores).find(k => errores[k]);
    if (primero) { $('m-' + primero).focus(); return; }

    const boton = $('enviar-mayorista');
    boton.disabled = true;
    boton.textContent = 'Enviando…';
    $('error-mayorista').hidden = true;
    try {
      if (!CFG.urlScript) throw new Error('Falta la URL del script en config.js');
      const r = await postScript(datos, 30000);
      if (!r || !r.ok) throw new Error((r && r.error) || 'No se pudo enviar.');
      f.hidden = true;
      $('mayorista-enviado-texto').textContent =
        `Si ${datos.mail} es correcto, te llega un enlace en unos minutos. Vence en 30 minutos y sirve una sola vez. Si no lo ves, revisá la carpeta de spam.`;
      $('mayorista-enviado').hidden = false;
      $('mayorista-enviado').focus();
      f.reset();
    } catch (err) {
      $('error-mayorista').textContent = err.message === 'Failed to fetch' ? 'Hubo un problema de conexión. Probá de nuevo.' : err.message;
      $('error-mayorista').hidden = false;
    } finally {
      boton.disabled = false;
      boton.textContent = 'Recibir el enlace';
    }
  }

  // ------------------------------------------------------------------
  // Formulario
  // ------------------------------------------------------------------

  function datosFormulario() {
    const f = $('formulario');
    const v = nombre => f.elements[nombre].value.trim();
    return {
      nombre: v('nombre'), telefono: v('telefono'), mail: v('mail'), pago: v('pago'), comentarios: v('comentarios'),
      consentimiento: f.elements.consentimiento.checked,
      sitio_web: f.elements.sitio_web.value,
    };
  }

  function marcarError(id, mensaje) {
    const campo = $('f-' + id);
    const error = $('e-' + id);
    campo.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
    error.textContent = mensaje || '';
    error.hidden = !mensaje;
  }

  function validar(d) {
    const errores = {
      nombre: d.nombre ? '' : 'Escribí tu nombre.',
      telefono: d.telefono || d.mail ? '' : 'Dejá un teléfono o un mail para poder responderte.',
      mail: d.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.mail) ? 'Revisá el mail: parece incompleto.' : '',
      consentimiento: d.consentimiento ? '' : 'Para enviar el pedido, marcá que aceptás el aviso de privacidad.',
    };
    Object.entries(errores).forEach(([k, m]) => marcarError(k, m));
    const primero = Object.keys(errores).find(k => errores[k]);
    if (primero) $('f-' + primero).focus();
    return !primero;
  }

  async function enviarFormulario(ev) {
    ev.preventDefault();
    const d = datosFormulario();
    $('error-envio').hidden = true;
    if (!validar(d)) return;

    const lineas = lineasPedido();
    if (!lineas.length) return;
    const boton = $('enviar-formulario');
    boton.disabled = true;
    boton.textContent = 'Enviando…';

    const cuerpo = Object.assign({}, d, {
      origen: estado.origen,
      sesion: sesionMayorista(), // si es mayorista, el script verifica la sesión y calcula su precio
      items: lineas.map(l => ({ codigo: l.p.codigo, cantidad: l.cantidad })),
    });

    try {
      if (!CFG.urlScript) throw new Error('Falta la URL del script en config.js');
      // ⚠️ NO AGREGAR CABECERAS (headers) A ESTE fetch. Ni "Content-Type: application/json" ni ninguna otra.
      // Con esa cabecera el navegador hace una verificación previa (preflight CORS) que Apps Script
      // no responde, y el pedido se pierde SIN mostrar ningún error. Se manda texto plano y el script
      // lo interpreta como JSON. No es un descuido: es la única forma que funciona.
      const r = await pedirJSON(CFG.urlScript, { method: 'POST', body: JSON.stringify(cuerpo) }, 30000);
      if (!r || !r.ok) throw new Error((r && r.error) || 'Respuesta inválida');
      pedidoEnviado(r.pedido, d);
    } catch (err) {
      console.error('No se pudo enviar el pedido:', err);
      mostrarErrorEnvio(err, d);
      boton.disabled = false;
      boton.textContent = 'Enviar pedido';
    }
  }

  // Si el envío falla, el cliente no se queda sin salida: se le ofrece el WhatsApp con el pedido ya escrito.
  function mostrarErrorEnvio(err, d) {
    const caja = $('error-envio');
    const motivo = err && err.name === 'AbortError' ? 'La conexión tardó demasiado.' : (err && err.message && !/fetch|network/i.test(err.message) ? err.message : 'Hubo un problema de conexión.');
    caja.replaceChildren(
      el('p', { texto: `No pudimos enviar el pedido. ${motivo}` }),
      el('p', {}, [
        'Podés mandarlo ahora por ',
        el('a', { href: enlaceWhatsapp(mensajePedido(d)), target: '_blank', rel: 'noopener', texto: 'WhatsApp, con el pedido ya escrito' }),
        ', o intentar de nuevo.',
      ])
    );
    caja.hidden = false;
    caja.scrollIntoView({ block: 'nearest' });
  }

  // Después de enviar: se oculta el formulario y queda la confirmación. Evita pedidos duplicados.
  function pedidoEnviado(numero, d) {
    estado.pedido = {};
    guardarLocal(CLAVE_PEDIDO, estado.pedido);
    $('formulario').reset();
    $('formulario').hidden = true;
    $('mostrar-formulario').setAttribute('aria-expanded', 'false');
    $('confirmacion-texto').textContent =
      `Tu número de pedido es ${numero}. Te vamos a contactar ${d.telefono ? 'al ' + d.telefono : 'a ' + d.mail} para confirmar precio, disponibilidad y entrega.`;
    $('confirmacion').hidden = false;
    pintarPedido();
    estado.catalogo.productos.forEach(p => pintarAccion(p));
    $('confirmacion').focus();
  }

  function otroPedido() {
    $('confirmacion').hidden = true;
    $('enviar-formulario').disabled = false;
    $('enviar-formulario').textContent = 'Enviar pedido';
    pintarPedido();
    $('panel-pedido').close();
    $('abrir-pedido').focus();
  }

  // ------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------

  function abrirPanelPedido() {
    if (!$('confirmacion').hidden && Object.keys(estado.pedido).length) $('confirmacion').hidden = true;
    pintarPedido();
    $('panel-pedido').showModal();
  }

  function iniciar() {
    if (CFG.logo) pintarMarca('Inicio');
    const panel = $('panel-pedido');
    // Los dos recuadros (pedido y producto) se cierran con ✕, con Escape o tocando el fondo oscuro.
    const alCerrar = (dialogo, cerrar) => {
      dialogo.addEventListener('click', e => { if (e.target === dialogo) cerrar(); });
      dialogo.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); cerrar(); } });
      dialogo.addEventListener('close', cerrar); // por si el navegador lo cierra por su cuenta
    };
    const cerrarPanel = () => {
      const estabaAbierto = panel.open;
      if (estabaAbierto) panel.close();
      if (estabaAbierto && !$('ficha').open) $('abrir-pedido').focus();
    };
    $('abrir-pedido').addEventListener('click', abrirPanelPedido);
    $('cerrar-pedido').addEventListener('click', cerrarPanel);
    alCerrar(panel, cerrarPanel);
    $('enviar-whatsapp').addEventListener('click', registrarWhatsapp);

    $('cerrar-ficha').addEventListener('click', cerrarFicha);
    alCerrar($('ficha'), cerrarFicha);
    window.addEventListener('popstate', alCambiarHistorial);

    // Menú de secciones (celular)
    $('abrir-menu').addEventListener('click', abrirMenu);
    $('cerrar-menu').addEventListener('click', () => cerrarMenu(true));
    alCerrar($('menu-movil'), () => cerrarMenu(true));

    // Barra lateral de filtros
    $('abrir-filtros').addEventListener('click', abrirFiltros);
    $('cerrar-filtros').addEventListener('click', cerrarFiltros);
    $('aplicar-filtros').addEventListener('click', cerrarFiltros);
    alCerrar($('filtros-panel'), cerrarFiltros);
    ANCHO_BARRA_LATERAL.addEventListener('change', acomodarBarraLateral);
    acomodarBarraLateral();
    $('orden').addEventListener('change', e => {
      estado.orden = e.target.value;
      estado.visibles = POR_PAGINA;
      if (estado.catalogo) pintarGrilla();
    });

    mostrarVista(false); // si se entró con ?pagina=…, muestra "Cargando…" en vez del catálogo

    // Mayoristas
    $('cerrar-mayorista').addEventListener('click', cerrarIngresoMayorista);
    $('mayorista-listo').addEventListener('click', cerrarIngresoMayorista);
    alCerrar($('dialogo-mayorista'), cerrarIngresoMayorista);
    $('formulario-mayorista').addEventListener('submit', enviarIngresoMayorista);
    const acceso = new URLSearchParams(location.search).get('acceso');
    if (acceso) canjearAcceso(acceso);
    else if (sesionMayorista()) cargarDatosMayorista();

    $('mostrar-formulario').addEventListener('click', () => {
      const f = $('formulario');
      f.hidden = !f.hidden;
      $('mostrar-formulario').setAttribute('aria-expanded', String(!f.hidden));
      if (!f.hidden) $('f-nombre').focus();
    });
    $('formulario').addEventListener('submit', enviarFormulario);
    $('otro-pedido').addEventListener('click', otroPedido);

    let espera;
    $('buscador').addEventListener('input', e => {
      clearTimeout(espera);
      espera = setTimeout(() => {
        estado.busqueda = e.target.value.trim();
        estado.visibles = POR_PAGINA;
        if (estado.catalogo) pintarGrilla();
      }, 150);
    });
    $('ver-mas').addEventListener('click', () => {
      const antes = estado.visibles;
      estado.visibles += POR_PAGINA;
      pintarGrilla();
      // El foco pasa al primer producto nuevo, para no volver al principio de la lista.
      const nuevo = $('grilla').children[antes];
      const boton = nuevo && nuevo.querySelector('button');
      if (boton) boton.focus();
    });

    cargar();
  }

  iniciar();
})();
