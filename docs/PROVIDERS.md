# Estado e validação dos providers

Todos os collectors ficam desabilitados por padrão. Eles só aparecem no registro depois que o respectivo `*_ENABLED=true` é definido no `.env`; `npm run providers:list` mostra o estado e o modo efetivos. Isso evita que uma instalação nova faça coleta externa sem uma decisão explícita do operador.

> **Autorização é pré-requisito, não uma configuração do software.** Os [termos de coleta automatizada da Meta](https://www.facebook.com/legal/automated_data_collection_terms) exigem permissão expressa por escrito; os [termos da OLX](https://ajuda.olx.com.br/s/article/termos-e-condicoes-de-uso) exigem autorização prévia e expressa para web crawling; e a seção 7.6 dos [termos do Programa de Desenvolvedores do Mercado Livre](https://developers.mercadolivre.com.br/pt_br/termos-e-condicoes) proíbe robôs/scraping fora do conteúdo fornecido pela API. Ter uma conta ou sessão válida não substitui essa autorização. Não habilite um provider web sem a permissão aplicável.

## Mercado Livre

### Modo API restrito/experimental

- O adapter contém busca paginada em `GET /sites/MLB/search`, mas esse caminho não deve ser tratado como uma API pública garantida de descoberta de anúncios de terceiros.
- Filtro de preço, limite, timeout, retry e tratamento de 429/5xx.
- Detalhes em `GET /items/{id}` e descrição em `GET /items/{id}/description`.
- Mapeamento de preço, moeda, imagens, atributos, localização, URL, ID e publicação.

### Por que esta estratégia

O Mercado Livre mantém APIs para aplicações e operações de vendedores no Programa de Desenvolvedores. A elegibilidade, os recursos e os escopos dependem da aplicação/conta; na prática, a busca ampla usada por um comparador de ofertas pode responder 401/403 ou não estar disponível. Por isso o adapter API permanece para integração autorizada e demonstração arquitetural, mas não é anunciado como provider funcional de busca pública.

### Precisa validar

- Token de uma aplicação real. A API pode responder 401/403 conforme políticas e escopo atuais.
- Categorias/classificados que omitam campos presentes em produtos comuns.

Para testar uma aplicação elegível, defina `MERCADOLIVRE_ENABLED=true` e `MERCADOLIVRE_MODE=api`. Você pode fornecer diretamente `MERCADOLIVRE_ACCESS_TOKEN` ou configurar `MERCADOLIVRE_CLIENT_ID`, `MERCADOLIVRE_CLIENT_SECRET` e `MERCADOLIVRE_REDIRECT_URI` para executar `npm run mercadolivre:login`. Nenhuma das duas opções garante acesso à busca pública; falha 401/403 deve ser tratada como indisponibilidade/escopo insuficiente, não como convite a migrar silenciosamente para scraping.

### Modo web alternativo

O modo web é explícito: não existe fallback silencioso da API para navegação. Use-o somente se você tiver permissão específica do Mercado Livre, definindo `MERCADOLIVRE_ENABLED=true` e `MERCADOLIVRE_MODE=web`. Crie ou renove a sessão com `npm run mercadolivre:web-login` antes de testar o provider.

Esse modo pesquisa resultados pelo navegador, mas ainda tenta obter a descrição pela API quando há um ID de anúncio. Mudanças de layout ou uma verificação manual podem causar `mercadolivre_web_search_failed` ou `mercadolivre_web_challenge_required`; nesses casos, renove a sessão, sem tentar contornar o desafio.

## OLX

Defina `OLX_ENABLED=true` e gere a sessão com `npm run olx:login` antes do primeiro teste. Criar a sessão não habilita o provider automaticamente.

### O que funciona no código

- Busca pública via navegador com query, preço mínimo/máximo, scroll progressivo e limite.
- Normalização de cards e abertura de cada anúncio relevante.
- Preferência por JSON-LD nos detalhes, com fallback para conteúdo semanticamente visível.
- Extração de descrição, imagens, vendedor público, localização e atributos expostos.
- Seletores centralizados e screenshot de inspeção.

### Por que não usa a API oficial de integração

A documentação oficial da OLX descreve APIs para importação e gestão do inventário do próprio anunciante. A [listagem de publicações](https://developers.olx.com.br/anuncio/api/published_ads.html) exige o token do anunciante e lista suas publicações; ela não é uma API de pesquisa pública de anúncios de terceiros. Por isso a V1 isola navegação web em `src/marketplaces/olx/`.

### Precisa validar manualmente

- Seletores e JSON-LD contra a página atual, região e eventuais experimentos de layout.
- Como a OLX representa localização na região desejada. A V1 envia somente os filtros de preço ao site; localização é aplicada depois pelo filtro determinístico, por igualdade de cidade normalizada e estado compatível quando reconhecido. O valor de raio não é enviado ao site nem medido geodesicamente.
- Consentimento de cookies e respostas de bloqueio no host self-hosted.

### Limitações

- Nenhuma evasão ou CAPTCHA bypass é implementado.
- Na validação de 07/08/2026, o host de desenvolvimento recebeu uma página explícita de bloqueio do Cloudflare antes dos resultados. O provider agora encerra rapidamente com `olx_access_blocked`; não tenta contornar a proteção. Isso precisa ser revalidado em um host com acesso normal/autorizado.
- Mudança de layout pode causar `olx_search_failed` ou `olx_listing_details_failed`; use `--inspect` e atualize somente `selectors.ts`/parser.

## Facebook Marketplace

Defina `FACEBOOK_ENABLED=true` e gere a sessão com `npm run facebook:login` antes do primeiro teste. Criar a sessão não habilita o provider automaticamente.

### O que funciona no código

- Login manual em Chromium gráfico e armazenamento do `storageState` em `data/facebook-session.json`.
- Reutilização da sessão para busca, scroll, cards e detalhes.
- Detecção explícita de sessão ausente/expirada.
- Seletores centralizados, fallbacks semânticos e screenshot de inspeção.

### Precisa validar manualmente

- Login, checkpoint e acesso ao Marketplace para a conta/região.
- Seletores atuais, textos traduzidos e filtros efetivamente aceitos pela URL.
- Qualidade da descrição e dos atributos visíveis para veículos/eletrônicos.

### Limitações

- O provider não contorna login, checkpoint, CAPTCHA ou bloqueios.
- `storageState` contém material sensível, fica em `data/`, nunca deve ser enviado ou commitado.
- Facebook pode alterar markup e limitar automação. Nesses casos o provider registra `facebook_session_expired` ou `facebook_search_failed` em vez de fingir sucesso.

## Login gráfico no modo servidor

O container sempre inicia o Xvfb pelo entrypoint. O VNC é opcional, fica vinculado a `127.0.0.1` pelo Compose e exige senha. Para uma sessão manual temporária, configure no `.env`:

```dotenv
VNC_ENABLED=true
# Exatamente 8 caracteres ASCII; valor de exemplo, troque-o.
VNC_PASSWORD=A7b9K2xQ
VNC_PORT=5900
```

Pare o app para liberar a porta e execute um dos CLIs compilados. Como a imagem usa `server-entrypoint.sh` como `ENTRYPOINT`, o comando abaixo mantém a preparação do Xvfb/VNC e substitui apenas o processo final:

```bash
docker compose --profile server stop app
docker compose -f docker-compose.yml -f docker-compose.vnc.yml --profile server \
  run --rm --service-ports app node dist/cli/facebook-login.js
# alternativas: dist/cli/olx-login.js ou dist/cli/mercadolivre-web-login.js
```

Enquanto o CLI aguarda, abra em outra máquina/terminal um túnel `ssh -L 5900:127.0.0.1:5900 usuario@servidor`, conecte o cliente VNC a `127.0.0.1:5900`, conclua a validação e pressione Enter no terminal do CLI. O RFB clássico limita a senha a oito caracteres e não cifra a sessão; nunca dispense o túnel. Prefira `VNC_PASSWORD_FILE` apontando para um secret montado no container. Depois, volte `VNC_ENABLED=false` e reinicie com `docker compose --profile server up -d app`.

## Checklist real

```bash
# Mercado Livre API (MERCADOLIVRE_ENABLED=true, MERCADOLIVRE_MODE=api)
npm run provider:test -- mercadolivre --query "RTX 3060 Ti"

# Alternativa web do Mercado Livre (MERCADOLIVRE_MODE=web)
npm run mercadolivre:web-login
npm run provider:test -- mercadolivre --query "RTX 3060 Ti" --inspect

# OLX (OLX_ENABLED=true)
npm run olx:login
npm run provider:test -- olx --query "RTX 3060 Ti" --inspect

# Facebook (FACEBOOK_ENABLED=true)
npm run facebook:login
npm run provider:test -- facebook --query "RTX 3060 Ti" --inspect
```

Considere o provider validado somente se `search()` retornar resultados normalizados e `getListingDetails()` trouxer um anúncio real. Testes unitários de fixtures não substituem esse checklist.
