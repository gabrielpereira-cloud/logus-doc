(function () {
  'use strict';

  var PASTA = 'versoes/';
  var SISTEMA = 'Logus ERP';
  var PRECARGA_SIMULTANEA = 4;

  var TIPOS = [
    { id: 'novidade', rotulo: 'Novidades' },
    { id: 'melhoria', rotulo: 'Melhorias' },
    { id: 'correcao', rotulo: 'Correções' },
    { id: 'migracao', rotulo: 'Migrações Delphi → Java' }
  ];

  var el = {
    tituloSistema: document.getElementById('titulo-sistema'),
    listaVersoes: document.getElementById('lista-versoes'),
    filtroTipos: document.getElementById('filtro-tipos'),
    limparFiltros: document.getElementById('limpar-filtros'),
    releases: document.getElementById('releases'),
    aviso: document.getElementById('aviso'),
    lateral: document.getElementById('lateral'),
    alternarMenu: document.getElementById('alternar-menu')
  };

  var indice = [];
  var dados = new Map();
  var filtros = { tipos: new Set() };
  var versaoAtual = '';
  var fila = Promise.resolve();
  var datasLaterais = {};
  var emVoo = {};

  /* ---------------- utilidades ---------------- */

  function formatarData(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso);
  }

  function rotuloTipo(tipo) {
    for (var i = 0; i < TIPOS.length; i++) {
      if (TIPOS[i].id === tipo) return TIPOS[i].rotulo;
    }
    return 'Outros';
  }

  function criar(tag, classe, texto) {
    var no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto != null) no.textContent = texto;
    return no;
  }

  function mostrarAviso(texto) {
    el.aviso.textContent = texto;
    el.aviso.hidden = false;
  }

  function limpar(no) {
    while (no.firstChild) no.removeChild(no.firstChild);
  }

  /* ---------------- hash da URL ---------------- */

  function lerHash() {
    var bruto = location.hash.replace(/^#/, '');
    if (!bruto) return;
    var partes = bruto.split('&');
    for (var i = 0; i < partes.length; i++) {
      var par = partes[i].split('=');
      var chave = decodeURIComponent(par[0]);
      var valor = decodeURIComponent(par.slice(1).join('=') || '');
      if (chave === 'v') versaoAtual = valor;
      else if (chave === 'tipos' && valor) filtros.tipos = new Set(valor.split(','));
    }
  }

  function escreverHash() {
    var partes = [];
    if (versaoAtual) partes.push('v=' + encodeURIComponent(versaoAtual));
    if (filtros.tipos.size) {
      partes.push('tipos=' + encodeURIComponent(Array.from(filtros.tipos).join(',')));
    }
    var hash = partes.length ? '#' + partes.join('&') : '';
    history.replaceState(null, '', location.pathname + location.search + hash);
  }

  /* ---------------- carregamento ---------------- */

  function chaveVersao(versao) {
    return String(versao).split(/[._-]/).map(Number);
  }

  function compararVersoes(a, b) {
    var ca = chaveVersao(a), cb = chaveVersao(b);
    for (var i = 0; i < Math.max(ca.length, cb.length); i++) {
      var na = ca[i] || 0, nb = cb[i] || 0;
      if (na !== nb) return nb - na;
    }
    return 0;
  }

  function versaoDoArquivo(caminho) {
    var arquivo = decodeURIComponent(String(caminho).split('?')[0].split('/').pop());
    var m = /^(\d+(?:[._-]\d+)+)\.json$/i.exec(arquivo);
    return m ? m[1] : null;
  }

  // Extrai os nomes de arquivo de uma listagem do S3 (XML) ou de um autoindex (HTML).
  function extrairVersoes(texto) {
    var nomes = [];
    var analisador = new DOMParser();

    if (/<ListBucketResult/i.test(texto)) {
      var xml = analisador.parseFromString(texto, 'application/xml');
      var chaves = xml.getElementsByTagName('Key');
      for (var i = 0; i < chaves.length; i++) nomes.push(chaves[i].textContent);
    } else {
      var doc = analisador.parseFromString(texto, 'text/html');
      var links = doc.querySelectorAll('a[href]');
      for (var j = 0; j < links.length; j++) nomes.push(links[j].getAttribute('href'));
    }

    var versoes = [];
    nomes.forEach(function (nome) {
      var v = versaoDoArquivo(nome);
      if (v && versoes.indexOf(v) === -1) versoes.push(v);
    });
    return versoes;
  }

  function tentarListagem(url) {
    return fetch(url, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(extrairVersoes)
      .catch(function () { return []; });
  }

  // Fallback: manifesto index.json, para hospedagens que não listam diretório (ex.: Tomcat).
  function tentarManifesto() {
    return fetch(PASTA + 'index.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        var lista = Array.isArray(json) ? json : (json && json.versoes) || [];
        return lista
          .map(function (item) { return typeof item === 'string' ? item : item && item.versao; })
          .filter(Boolean);
      })
      .catch(function () { return []; });
  }

  function carregarIndice() {
    el.tituloSistema.textContent = 'Versões — ' + SISTEMA;
    document.title = 'Versões — ' + SISTEMA;

    // 1) autoindex do servidor (nginx/Apache) ou listagem do bucket na própria pasta
    return tentarListagem(PASTA)
      .then(function (versoes) {
        // 2) API de listagem do S3 na raiz do bucket
        if (versoes.length) return versoes;
        return tentarListagem('?list-type=2&prefix=' + encodeURIComponent(PASTA));
      })
      .then(function (versoes) {
        if (versoes.length) return versoes;
        return tentarManifesto();
      })
      .then(function (versoes) {
        if (!versoes.length) throw new Error('nenhuma versão encontrada em ' + PASTA);
        indice = versoes.sort(compararVersoes).map(function (v) { return { versao: v }; });
      });
  }

  function buscarVersao(entrada) {
    // evita baixar o mesmo arquivo duas vezes quando a pré-carga cruza com um clique
    if (emVoo[entrada.versao]) return emVoo[entrada.versao];

    var promessa = fetch(PASTA + entrada.versao + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        json.versao = json.versao || entrada.versao;
        json.data = json.data || entrada.data;
        entrada.data = json.data;
        atualizarDataNaLateral(entrada.versao, json.data);
        dados.set(entrada.versao, json);
        return json;
      });

    emVoo[entrada.versao] = promessa;
    return promessa
      .then(function (json) { delete emVoo[entrada.versao]; return json; })
      .catch(function (erro) { delete emVoo[entrada.versao]; throw erro; });
  }

  function carregarVersao(entrada) {
    if (dados.has(entrada.versao)) return Promise.resolve(dados.get(entrada.versao));

    return buscarVersao(entrada).catch(function (erro) {
      var falha = {
        versao: entrada.versao,
        data: entrada.data,
        erro: 'Não foi possível carregar as notas desta versão (' + erro.message + ').'
      };
      dados.set(entrada.versao, falha);
      return falha;
    });
  }

  // Busca os arquivos em segundo plano só para preencher as datas do menu lateral
  // (e deixar a troca de versão instantânea). Falha aqui é silenciosa e não vira cache.
  function precarregarDatas() {
    var pendentes = indice.slice();

    function proxima() {
      var entrada = pendentes.shift();
      if (!entrada) return Promise.resolve();
      if (dados.has(entrada.versao)) return proxima();
      return buscarVersao(entrada).catch(function () {}).then(proxima);
    }

    var trabalhadores = [];
    for (var i = 0; i < PRECARGA_SIMULTANEA; i++) trabalhadores.push(proxima());
    return Promise.all(trabalhadores);
  }

  function selecionar(versao) {
    var entrada = indice.filter(function (e) { return e.versao === versao; })[0];
    if (!entrada) return Promise.resolve();

    versaoAtual = versao;
    escreverHash();
    marcarAtualNaLateral();
    el.lateral.classList.remove('aberta');
    el.alternarMenu.setAttribute('aria-expanded', 'false');

    if (dados.has(versao)) {
      renderizar();
      return Promise.resolve();
    }

    limpar(el.releases);
    el.releases.appendChild(criar('p', 'carregando', 'Carregando versão ' + versao + '…'));

    fila = fila.then(function () {
      return carregarVersao(entrada).then(function () {
        if (versaoAtual === versao) renderizar();
      });
    });
    return fila;
  }

  /* ---------------- filtros ---------------- */

  function montarFiltroTipos() {
    TIPOS.forEach(function (tipo) {
      var rotulo = criar('label', 'chip');
      var caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.value = tipo.id;
      caixa.checked = filtros.tipos.has(tipo.id);
      caixa.addEventListener('change', function () {
        if (caixa.checked) filtros.tipos.add(tipo.id);
        else filtros.tipos.delete(tipo.id);
        escreverHash();
        renderizar();
      });
      rotulo.appendChild(caixa);
      rotulo.appendChild(document.createTextNode(tipo.rotulo));
      el.filtroTipos.appendChild(rotulo);
    });
  }

  function itensVisiveis(release) {
    return (release.itens || []).filter(function (item) {
      if (!item) return false;
      if (filtros.tipos.size && !filtros.tipos.has(item.tipo)) return false;
      return true;
    });
  }

  /* ---------------- renderização ---------------- */

  function renderizarLateral() {
    limpar(el.listaVersoes);
    datasLaterais = {};

    indice.forEach(function (entrada) {
      var li = document.createElement('li');
      var botao = document.createElement('button');
      botao.type = 'button';
      if (entrada.versao === versaoAtual) botao.setAttribute('aria-current', 'true');

      botao.appendChild(criar('span', 'item-versao-numero', entrada.versao));

      // a data só é conhecida depois que o arquivo da versão é baixado
      var linha = criar('span', 'item-versao-info', formatarData(entrada.data));
      datasLaterais[entrada.versao] = linha;
      botao.appendChild(linha);

      botao.addEventListener('click', function () {
        selecionar(entrada.versao);
      });

      li.appendChild(botao);
      el.listaVersoes.appendChild(li);
    });
  }

  function atualizarDataNaLateral(versao, data) {
    var linha = datasLaterais[versao];
    if (!linha) return;
    linha.textContent = formatarData(data);
    linha.title = linha.textContent;
  }

  function renderizarRelease(release) {
    var artigo = criar('article', 'release');

    var cabecalho = criar('header', 'release-cabecalho');
    cabecalho.appendChild(criar('span', 'release-versao', release.versao));
    if (release.data) {
      cabecalho.appendChild(criar('span', 'release-data', formatarData(release.data)));
    }
    artigo.appendChild(cabecalho);

    if (release.erro) {
      artigo.classList.add('release-erro');
      artigo.appendChild(criar('p', 'release-vazio', release.erro));
      return artigo;
    }

    var visiveis = itensVisiveis(release);
    var ordem = TIPOS.map(function (t) { return t.id; });
    var outros = [];
    visiveis.forEach(function (item) {
      if (ordem.indexOf(item.tipo) === -1 && outros.indexOf(item.tipo) === -1) {
        outros.push(item.tipo);
      }
    });

    ordem.concat(outros).forEach(function (tipo) {
      var doTipo = visiveis.filter(function (item) { return item.tipo === tipo; });
      if (!doTipo.length) return;

      var grupo = criar('section', 'grupo');
      grupo.dataset.tipo = tipo;
      grupo.appendChild(criar('h3', 'grupo-titulo', rotuloTipo(tipo)));

      var ul = criar('ul', 'itens');
      doTipo.forEach(function (item) {
        var li = document.createElement('li');
        if (item.funcionalidade) {
          li.appendChild(criar('span', 'selo-funcionalidade', String(item.funcionalidade).trim()));
        }
        li.appendChild(document.createTextNode(item.texto || ''));
        ul.appendChild(li);
      });
      grupo.appendChild(ul);
      artigo.appendChild(grupo);
    });

    if (!visiveis.length) {
      artigo.appendChild(criar('p', 'release-vazio', 'Nenhum item desta versão corresponde aos filtros selecionados.'));
    }

    return artigo;
  }

  function renderizar() {
    limpar(el.releases);

    var release = dados.get(versaoAtual);
    if (!release) {
      el.releases.appendChild(criar('p', 'release-vazio',
        indice.length ? 'Selecione uma versão no menu.' : 'Nenhuma versão publicada até o momento.'));
      return;
    }

    el.releases.appendChild(renderizarRelease(release));
    marcarAtualNaLateral();
  }

  function marcarAtualNaLateral() {
    var botoes = el.listaVersoes.querySelectorAll('button');
    for (var i = 0; i < botoes.length; i++) {
      var versao = botoes[i].querySelector('.item-versao-numero').textContent;
      if (versao === versaoAtual) botoes[i].setAttribute('aria-current', 'true');
      else botoes[i].removeAttribute('aria-current');
    }
  }

  /* ---------------- eventos ---------------- */

  el.limparFiltros.addEventListener('click', function () {
    filtros.tipos.clear();
    var caixas = el.filtroTipos.querySelectorAll('input');
    for (var i = 0; i < caixas.length; i++) caixas[i].checked = false;
    escreverHash();
    renderizar();
  });

  el.alternarMenu.addEventListener('click', function () {
    var aberta = el.lateral.classList.toggle('aberta');
    el.alternarMenu.setAttribute('aria-expanded', String(aberta));
  });

  /* ---------------- início ---------------- */

  lerHash();
  montarFiltroTipos();

  carregarIndice()
    .then(function () {
      renderizarLateral();
      var existe = indice.some(function (entrada) { return entrada.versao === versaoAtual; });
      var pronto = selecionar(existe ? versaoAtual : indice[0].versao);
      precarregarDatas();
      return pronto;
    })
    .catch(function (erro) {
      mostrarAviso('Não foi possível montar a lista de versões: ' + erro.message +
        '. Libere a listagem da pasta (autoindex no nginx/Apache ou s3:ListBucket no bucket) ' +
        'ou publique um ' + PASTA + 'index.json com as versões.');
    });
})();
