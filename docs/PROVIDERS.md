# Estado e validação dos providers

## Mercado Livre

### O que funciona

- Busca paginada em `GET /sites/MLB/search`.
- Filtro de preço, limite, timeout, retry e tratamento de 429/5xx.
- Detalhes em `GET /items/{id}` e descrição em `GET /items/{id}/description`.
- Mapeamento de preço, moeda, imagens, atributos, localização, URL, ID e publicação.

### Por que esta estratégia

O Mercado Livre documenta a busca de itens e o multiget na [documentação oficial de itens e buscas](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas). A implementação envia Bearer token quando configurado e transforma respostas específicas em contratos internos.

### Precisa validar

- Token de uma aplicação real. A API pode responder 401/403 conforme políticas e escopo atuais.
- Categorias/classificados que omitam campos presentes em produtos comuns.

## OLX

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
- Como a OLX representa localização/raio na região desejada. A V1 envia filtros de preço no site e aplica a localização novamente no filtro determinístico; não afirma precisão geodésica do raio.
- Consentimento de cookies e respostas de bloqueio no host self-hosted.

### Limitações

- Nenhuma evasão ou CAPTCHA bypass é implementado.
- Na validação de 07/08/2026, o host de desenvolvimento recebeu uma página explícita de bloqueio do Cloudflare antes dos resultados. O provider agora encerra rapidamente com `olx_access_blocked`; não tenta contornar a proteção. Isso precisa ser revalidado em um host com acesso normal/autorizado.
- Mudança de layout pode causar `olx_search_failed` ou `olx_listing_details_failed`; use `--inspect` e atualize somente `selectors.ts`/parser.

## Facebook Marketplace

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

## Checklist real

```bash
npm run provider:test -- mercadolivre --query "RTX 3060 Ti"
npm run provider:test -- olx --query "RTX 3060 Ti" --inspect
npm run facebook:login
npm run provider:test -- facebook --query "RTX 3060 Ti" --inspect
```

Considere o provider validado somente se `search()` retornar resultados normalizados e `getListingDetails()` trouxer um anúncio real. Testes unitários de fixtures não substituem esse checklist.
