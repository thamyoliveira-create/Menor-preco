# PreçoMenor

Ferramenta pessoal para organizar ofertas de afiliada Shopee, calcular o retorno financeiro de cada oferta e preparar o disparo das mensagens no WhatsApp (grupos, status) e Instagram.

Reconstruído em setembro/2026 a partir da descrição do projeto original (o repositório havia sido esvaziado antes do push dos commits `6541912`, `2e302b2` e `e5b1127`).

## O que o app faz hoje

- **Aba Ofertas**: cadastro manual de cada oferta (produto, preço, link do produto, desconto, comissão normal, comissão extra, avaliação, frete grátis, cupom). O app calcula um **score de prioridade de publicação** combinando desconto + comissão + comissão extra + avaliação + frete + cupom.
- **Triagem inteligente**: pesquisa as ofertas cadastradas por nome e categoria, calcula uma nota de pertinência de 0 a 100 e explica os sinais favoráveis e os alertas. É possível filtrar por status, categoria e nota mínima.
- **Aprovação humana**: toda oferta começa como pendente. A mensagem de WhatsApp só pode ser preparada depois que você aprovar o produto. Ofertas rejeitadas podem guardar o motivo da decisão.
- **Aba Lucro**: para cada oferta, informe comissão normal (%), comissão extra (%) e quantidade de vendas registradas. O app calcula:
  - ganho estimado por venda
  - ganho acumulado
  - prioridade financeira (para comparar ofertas de preços diferentes)
- **Fluxo de publicação**: selecionar oferta → gerar texto pronto → escolher canal/grupo (com Sub_id próprio para cada canal) → abrir WhatsApp Web/Business já com a mensagem preenchida.
- **Aba Configurações**: guarda localmente (no seu navegador, via `localStorage`) o AppID da Shopee e os canais/grupos que você usa. **A senha/token da API nunca é salva no código do repositório.**

## Por que a comissão ainda é manual

A Shopee Affiliate Open API exige que cada requisição seja **assinada no servidor** com HMAC-SHA256 usando o AppID + a Senha (segredo). Não é seguro nem possível fazer isso direto do navegador, porque qualquer pessoa que abrir o site conseguiria ver a Senha no código-fonte.

Por isso:
- **Hoje**: você digita a comissão que aparece no seu painel de afiliada → o app calcula o resto.
- **Depois** (quando você tiver um backend rodando, ex: Node.js): a Senha fica só no servidor (variável de ambiente), o servidor assina as chamadas à API GraphQL da Shopee, busca produtos/comissões automaticamente, e o frontend só consome esse resultado.

O arquivo `server/shopee-client.js` já traz um exemplo de como assinar e chamar a API quando você estiver pronta para esse passo.

## Segurança — leia antes de usar

- **Nunca** coloque o AppID e a Senha reais direto no código (`index.html`, `script.js`, etc). Este repositório é público.
- Use o arquivo `.env.example` como modelo: copie para `.env`, preencha com seus dados reais, e o `.gitignore` já impede que o `.env` seja enviado ao GitHub.
- Se em algum momento uma Senha da API vazar (ficar visível num commit público), redefina-a imediatamente na página "Abrir API" do painel de afiliados Shopee.

## Estrutura

```
menor-preco/
├── index.html          # interface (abas Ofertas / Lucro / Configurações)
├── style.css           # estilos
├── script.js           # lógica do app (cálculo de score, lucro, geração de mensagem, WhatsApp)
├── server/
│   └── shopee-client.js  # exemplo de chamada assinada à Shopee Affiliate Open API (uso futuro)
├── .env.example        # modelo de variáveis de ambiente (AppID/Senha) — NÃO tem valores reais
└── .gitignore
```

## Próximos passos sugeridos

1. Usar o app manualmente por um tempo (Ofertas + Triagem + Lucro) para ajustar os critérios ao perfil dos seus grupos.
2. Montar um backend simples (Node.js) que use `server/shopee-client.js` para buscar produtos e comissões automaticamente.
3. Adicionar Sub_id por canal nos links de afiliado para descobrir qual grupo/rede converte melhor.
4. Avaliar a integração oficial de afiliados da Shopee no Instagram para contas profissionais elegíveis.
