# AI Deal Finder

Serviço self-hosted em Node.js/TypeScript que pesquisa anúncios em Facebook Marketplace, OLX e Mercado Livre, mantém histórico no PostgreSQL e combina estatística, regras e uma LLM OpenAI-compatible para identificar oportunidades.

> [!IMPORTANT]
> Projeto independente e não oficial, sem vínculo, patrocínio ou aprovação de Facebook/Meta, OLX ou Mercado Livre. Use somente em contas e ambientes autorizados, respeitando leis, direitos de terceiros e os termos aplicáveis de cada plataforma.

O projeto não implementa bypass de CAPTCHA, evasão de bloqueios, acesso não autorizado nem coleta em massa. Quando uma plataforma exigir verificação humana ou bloquear o acesso, o provider interrompe ou reduz sua funcionalidade. Dados coletados, cookies, tokens, perfis de navegador e screenshots são locais e não devem ser publicados.

## Estado da V1

A arquitetura e o pipeline da V1 estão implementados. Mercado Livre usa a API oficial; OLX e Facebook usam Playwright com baixa concorrência e seletores isolados. Como páginas web e sessões mudam, OLX/Facebook exigem validação manual no ambiente onde serão executados. Veja [docs/PROVIDERS.md](docs/PROVIDERS.md).

O fluxo executado é:

```text
Search → MarketplaceProvider → deduplicação → PostgreSQL → detalhes
       → CategoryAnalyzer → comparáveis → medianas por fonte/combinada
       → filtros → score determinístico → LLM (candidatos) → Telegram
```

`MarketplaceProvider` não contém análise de categoria. `CategoryAnalyzer` não conhece HTML, endpoints ou formatos dos marketplaces.

## Requisitos

- Node.js 22+
- Docker com Compose
- Chromium do Playwright (necessário apenas ao executar providers web fora do container)
- Xvfb para executar providers visíveis sem monitor físico; ele já vem preparado na imagem do servidor

## Início rápido

O arquivo `.env` local foi criado a partir do exemplo e é ignorado pelo Git. Ajuste as credenciais opcionais e execute:

```bash
npm install
npx playwright install chromium
docker compose up -d postgres
npm run prisma:migrate
npm run build
npm test
npm run dev
```

No Arch/Omarchy, instale a tela virtual uma única vez:

```bash
omarchy pkg add xorg-server-xvfb
```

Para executar tudo no Ubuntu Server:

```bash
mkdir -p data .runtime
docker compose --profile server up --build -d
docker compose logs -f app
```

O PostgreSQL fica exposto apenas em `127.0.0.1:5433` por padrão. Altere `POSTGRES_PORT` se necessário.
Se já houver Chromium no host, defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (por exemplo, `/usr/bin/chromium`) e dispense o download do browser do Playwright.

## Configuração

Obrigatório para persistência:

- `DATABASE_URL`

Necessário para o pipeline completo:

- Mercado Livre: `MERCADOLIVRE_ACCESS_TOKEN` quando a API responder 401/403 para a aplicação.
- Mercado Livre: quando a busca pública da API estiver restrita, use `npm run mercadolivre:web-login`; o coletor web pode exigir uma janela visível e renovação manual do CAPTCHA.
- Facebook: sessão gerada por `npm run facebook:login`.
- OLX: sessão normal do navegador gerada por `npm run olx:login`.
- LLM: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_EXTRACTION_MODEL` e `LLM_ANALYSIS_MODEL`.
- Telegram: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`.

OpenRouter funciona apontando `LLM_BASE_URL` para seu endpoint OpenAI-compatible. O exemplo usa `deepseek/deepseek-v4-flash-0731`, mas os modelos permanecem configuráveis. Sem LLM, o sistema continua calculando e persistindo o score determinístico; sem Telegram, apenas não envia notificações.

Modelos gratuitos podem responder lentamente; `LLM_REQUEST_TIMEOUT_MS` controla a espera da IA separadamente do timeout dos navegadores.

## Comandos

```bash
npm run dev
npm run build
npm start
npm run start:xvfb

npm run facebook:login
npm run olx:login
npm run mercadolivre:login
npm run mercadolivre:web-login
npm run telegram:configure
npm run providers:list
npm run provider:test -- mercadolivre --query "RTX 3060 Ti"
npm run provider:test -- olx --query "RTX 3060 Ti" --inspect
npm run provider:test -- facebook --query "RTX 3060 Ti" --inspect

npm run search:create
npm run search:create -- --name "RTX barata" --query "RTX 3060 Ti" --category gpu --max-price 1500 --location Itajaí --radius-km 100
npm run search:list
npm run search:run
npm run search:run -- --id <search-id>
npm run listings:recent

npm run prisma:migrate
npm run prisma:studio
npm test
```

Para OLX e Mercado Livre com verificação do navegador, inicie apenas o banco no Docker e execute o aplicativo no host:

```bash
docker compose up -d postgres
npm run start:xvfb
```

`start:xvfb` cria uma tela virtual automaticamente para execução direta no host. No modo `server`, a própria imagem inicia o Xvfb.

O modo `server` também disponibiliza VNC somente em `127.0.0.1:5900`. Nunca exponha essa porta publicamente; acesse-a por túnel SSH quando precisar resolver login, QR Code ou CAPTCHA:

```bash
ssh -L 5900:127.0.0.1:5900 usuario@servidor
```

Depois, conecte seu cliente VNC local a `127.0.0.1:5900`. As sessões ficam em `.runtime`, que deve ser copiada com segurança para o servidor e nunca enviada ao Git.

O serviço `app` fica no perfil `server`, para que o desenvolvimento local possa continuar iniciando apenas o PostgreSQL. Dentro desse perfil, o agendador é ativado automaticamente.

`--inspect` grava apenas um screenshot em `data/debug/`, diretório ignorado pelo Git. Revise e apague screenshots do Facebook porque podem conter dados visíveis da conta.

## Dados e scoring

O banco mantém `Search`, `Listing`, a relação N:N `SearchListing`, histórico de preço, dados estruturados JSONB, análises, notificações e correspondências prováveis entre marketplaces. Anúncios de fontes distintas nunca são mesclados. Correspondências prováveis apenas evitam dupla contagem na amostra usada naquela análise.

O score determinístico usa preço vs. mediana, orçamento, características, qualidade do anúncio, riscos e confiança da amostra, totalizando até 90 pontos. A LLM acrescenta no máximo 10 pontos. Amostras com menos de 5 itens têm confiança baixa; 5–9, média; 10+, alta.

Alegações como “nunca foi de leilão” são persistidas como `sellerClaimsNoAuction`, nunca como fato verificado.

## Segurança e carga

- `.env`, `data/`, logs e storage state estão no `.gitignore`.
- Tokens e cabeçalhos de autorização são redigidos dos logs.
- Senhas, cookies e tokens não existem no código.
- Providers web usam concorrência baixa, timeout e scroll limitado.
- Não há CAPTCHA bypass, evasão, mascaramento de automação ou tentativa de contornar bloqueios.
- O repositório não deve conter anúncios coletados, cookies, storage states, tokens, perfis de navegador ou screenshots reais.
- Para builds remotos, `.dockerignore` também exclui `.env`, `.runtime`, dados e arquivos locais do agente.
- A porta VNC do modo servidor fica vinculada somente a `127.0.0.1` e deve ser acessada exclusivamente por túnel SSH.
- Em produção, substitua a senha de exemplo do PostgreSQL por um valor longo e exclusivo.

Consulte [SECURITY.md](SECURITY.md) para tratamento de credenciais e reporte responsável.

## Licença

Código disponibilizado sob a [licença MIT](LICENSE). A licença cobre somente este código e não concede direitos sobre marcas, conteúdo, APIs ou serviços das plataformas consultadas.

## Testes

Os testes unitários usam fixtures e não acessam sites reais. Cobrem normalização, deduplicação, matching, estatística, filtros, scoring, Zod, mappers/parsers e analyzers. Os testes reais de providers são intencionalmente comandos separados porque dependem de rede, credenciais, região e layout atual.
