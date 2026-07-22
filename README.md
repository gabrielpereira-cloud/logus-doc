# Página de Versões do Sistema

Página estática (HTML + CSS + JavaScript puro, sem framework e sem CDN) que exibe o histórico de
versões do sistema: novidades, melhorias, correções e as migrações de Delphi para a plataforma web.

Publicar uma versão nova = **subir um arquivo JSON** na pasta `versoes/`. Só isso: a página descobre
os arquivos sozinha a cada carregamento. Nada de manifesto para atualizar, nada de rebuild, nada de
reiniciar serviço.

A página mostra **uma versão por vez** — a selecionada no menu lateral. Ao abrir, mostra a mais recente.

## Estrutura

```
index.html
assets/estilos.css
assets/app.js
versoes/
  07.26.21.00.json    <- uma release por arquivo, nada além disso
  07.26.20.00.json
ferramentas/validar.py
.github/workflows/publicar.yml   <- valida e publica no GitHub Pages a cada push
```

## Como a página descobre as versões

Sem manifesto. A cada carregamento ela tenta, nesta ordem:

1. **Listagem da pasta** — `GET versoes/`. Funciona com autoindex do nginx (`autoindex on;`) ou do
   Apache (`Options +Indexes`).
2. **API de listagem do S3** — `GET /?list-type=2&prefix=versoes/`. Funciona quando o bucket permite
   `s3:ListBucket` e a página é servida do próprio bucket/CloudFront (mesma origem, sem CORS).
3. **`versoes/index.json`** — só se as duas anteriores falharem, para hospedagens que não listam
   diretório (**GitHub Pages** e Tomcat são os casos típicos). Gere com
   `python3 ferramentas/validar.py --index` — no GitHub Pages isso é feito pelo Actions a cada push,
   então continua sem passo manual.

Os nomes de arquivo fora do padrão `<números>.json` são ignorados, e a ordenação é feita pelos
segmentos numéricos da versão (07.26.9.00 vem antes de 07.26.10.00, ao contrário da ordem alfabética).
Se nenhuma das três funcionar, a página explica na tela o que liberar.

## Como adicionar uma versão

1. Crie `versoes/<versao>.json` (o nome do arquivo é a própria versão, ex.: `07.26.22.00.json`):

```json
{
  "versao": "07.26.22.00",
  "data": "2026-08-05",
  "itens": [
    { "tipo": "novidade", "funcionalidade": "505 - Nota de Crédito e Débito", "texto": "..." },
    { "tipo": "melhoria", "funcionalidade": "101 - Curva ABC",                 "texto": "..." },
    { "tipo": "correcao", "funcionalidade": "118 - Preços e Promoções",        "texto": "..." },
    { "tipo": "migracao", "funcionalidade": "302 - Fornecedores",              "texto": "..." }
  ]
}
```

Regras:

- **Nome do arquivo == campo `versao`.**
- `data` em `yyyy-MM-dd` (a página exibe `dd/MM/yyyy`).
- `tipo`: `novidade` | `melhoria` | `correcao` | `migracao`.
- `funcionalidade` é um texto no padrão **`"<número> - <Nome>"`** (ex.: `"302 - Fornecedores"`), com o
  número que a funcionalidade já tem no sistema. É opcional; quando presente vira o selinho do item.
  O número na frente é o que evita a mesma tela aparecer escrita de dois jeitos — mantenha-o.
  Cuidado: um campo ou filtro *dentro* de uma tela pertence a ESSA tela — use a tela onde a mudança
  aparece, não a do assunto.
- A release tem só `versao`, `data` e `itens` — sem título nem resumo.
- Arquivo em **UTF-8**, com acentuação correta. O texto é para o usuário final: fale do benefício,
  sem jargão técnico, nome de classe, tabela ou número de ticket.

2. (Opcional) Valide antes de subir:

```bash
python3 ferramentas/validar.py
.github/workflows/publicar.yml   <- valida e publica no GitHub Pages a cada push
```

Confere nome do arquivo, `versao`, formato da `data`, tipos válidos, texto presente e o padrão
`"<número> - <Nome>"` da `funcionalidade`. Sai com código 1 se achar problema. Use `--index` se a sua hospedagem não listar diretório.

3. Suba o arquivo novo para a pasta `versoes/`. Só ele — mais nada precisa mudar.

## Testar localmente

`fetch` não funciona em `file://` — sirva a pasta por HTTP:

```bash
cd versoes-web
python3 -m http.server 8000
# abra http://localhost:8000
```

## Publicar

### GitHub Pages (com Actions)

É o caminho mais simples: HTTPS de graça, sem bucket para configurar e sem custo. O Pages **não lista
diretório**, então o `versoes/index.json` é obrigatório lá — mas o workflow o gera sozinho.

1. Crie o repositório e envie os arquivos:

```bash
git init -b main
git add .
git commit -m "Página de versões"
git remote add origin git@github.com:ORG/versoes-web.git
git push -u origin main
```

2. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

3. Pronto. A partir daí, publicar uma versão é `git add versoes/07.26.23.00.json && git commit && git push`.

O workflow (`.github/workflows/publicar.yml`) faz, a cada push na `main`:

- roda `validar.py --index` — **se algum arquivo estiver quebrado, o deploy é barrado** (isto é uma
  vantagem sobre o upload direto no S3, que publica qualquer coisa);
- monta `_site/` com apenas `index.html`, `assets/` e `versoes/` — o `ferramentas/` e o `README` não
  vão para o ar;
- publica no Pages.

A página funciona em subcaminho (`https://org.github.io/versoes-web/`) porque todos os caminhos são
relativos. Limitação a saber: no Pages você não controla cabeçalhos HTTP, então não dá para adicionar
CSP/HSTS próprios — se isso for requisito, use S3 + CloudFront.

### S3 + CloudFront (site estático)

Copie a pasta inteira para a raiz do bucket. Todos os caminhos são relativos, então funciona em
qualquer prefixo.

```bash
aws s3 sync . s3://SEU-BUCKET/ --exclude "ferramentas/*" --exclude "README.md" --delete
```

Cache: a listagem é buscada com `cache: 'no-cache'`, então uma release nova aparece no F5 seguinte sem
esperar expiração. Os `<versao>.json` são imutáveis e podem ter cache longo. Com CloudFront de TTL alto
a listagem pode ficar velha — nesse caso invalide o prefixo depois de subir a versão:

```bash
aws cloudfront create-invalidation --distribution-id SEU-ID --paths "/versoes*"
```

Segurança: para a descoberta funcionar no S3 é preciso liberar `s3:ListBucket` — restrinja ao prefixo,
ou qualquer um enumera o bucket inteiro:

```json
{
  "Sid": "ListarSomenteVersoes",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::MEU-BUCKET",
  "Condition": { "StringLike": { "s3:prefix": "versoes/*" } }
}
```

Use um bucket dedicado a este site, mantenha o Block Public Access para escrita e sirva sempre por
HTTPS (o endpoint de site do S3 é HTTP puro — CloudFront resolve).

### Servidor próprio (Tomcat/EC2/nginx)

Copie a pasta para um diretório servido estaticamente. No nginx/Apache, ligue o autoindex **apenas** no
`location /versoes/`. No Tomcat, gere o `index.json` com `validar.py --index`.

## Personalizar a identidade visual

Todas as cores estão no bloco `:root` no topo de `assets/estilos.css` (com variação automática para
tema escuro logo abaixo). A logo é o quadrado com a letra em `index.html` (`.marca-logo`) — troque por
um `<img>` se tiver o arquivo. O nome do sistema exibido no cabeçalho vem da constante `SISTEMA`, no
topo de `assets/app.js`.

## Recursos da página

- Menu lateral com todas as versões, montado só a partir da listagem — nenhum arquivo de release é
  baixado até você escolher uma.
- Uma versão por vez na área principal: abre na mais recente e troca ao clicar no menu. Cada arquivo
  já baixado fica em cache, então voltar numa versão já vista é instantâneo.
- As datas do menu aparecem sozinhas logo na abertura: como a listagem só traz nomes de arquivo, a
  página busca os arquivos em segundo plano (4 por vez, `PRECARGA_SIMULTANEA` em `assets/app.js`) só
  para preencher as datas — e isso deixa a troca de versão instantânea, já em cache.
- Filtro por tipo (Novidades / Melhorias / Correções / Migrações), aplicado dentro da versão exibida.
- Link direto para uma versão e para um filtro via hash: `#v=07.26.21.00&tipos=correcao`.
- Se o `<versao>.json` escolhido estiver ausente ou inválido, o card mostra o erro daquela versão e o
  menu continua navegável.
