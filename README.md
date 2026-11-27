# Copilot Roadmap Tracker

Página estática (GitHub Pages) para acompanhar novidades do **Microsoft 365 Copilot** em duas fontes:

| Fonte | O que traz | Como é lida |
|---|---|---|
| [Microsoft 365 Roadmap](https://www.microsoft.com/microsoft-365/roadmap) (oficial) | Features planejadas, em implantação e lançadas | API pública `releasecommunications/api/v1/m365`, filtrada por Copilot — **só pelo GitHub Action** (a API não permite chamadas do navegador / CORS) |
| [Message Center Archive – mc.merill.net](https://mc.merill.net/) | Espelho do Message Center do Admin Center (anúncios MC…) | RSS público, filtrado por Copilot — pelo Action **e** ao vivo pelo botão "Verificar agora" |

## Como funciona

- `scripts/fetch-data.mjs` (Node 18+, sem dependências) baixa as duas fontes, filtra o que é Copilot do M365 e grava `data/roadmap.json`, `data/messagecenter.json` e `data/meta.json`. O histórico é preservado: mensagens antigas que saem do RSS continuam no arquivo, e mudanças de status no Roadmap ficam registradas (`previousStatus`).
- `.github/workflows/update-data.yml` roda o script **a cada 6 horas** e também manualmente (Actions → *Atualizar dados do Copilot* → *Run workflow*), fazendo commit dos dados novos. O GitHub Pages republica sozinho.
- Na página, **Verificar agora** recarrega os dados publicados e consulta o Message Center ao vivo. **Atualização completa ↗** abre o workflow no GitHub para rodar a coleta das duas fontes na hora.
- "Lido / não lido" fica salvo no navegador de cada pessoa (localStorage). Itens dos últimos 14 dias antes da primeira visita aparecem como novos.

## Publicar no GitHub Pages

1. Crie um repositório (ex.: `copilot-roadmap`) e envie estes arquivos para a branch `main`.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `/ (root)`**.
3. **Settings → Actions → General → Workflow permissions → Read and write permissions** (para o Action poder commitar os dados).
4. Rode o workflow uma vez em **Actions → Atualizar dados do Copilot → Run workflow**.
5. Acesse https://syn4psxfxr.github.io/Release-Center/

> Repositório privado + Pages exige plano GitHub Team/Enterprise. Em Enterprise Cloud dá para restringir o site a membros da organização (Pages privado).

## Testar localmente

```powershell
node scripts/fetch-data.mjs
npx serve .
```

## Ajustar o filtro

Edite `COPILOT_PRODUCTS` e `NON_M365` em `scripts/fetch-data.mjs` (e as constantes equivalentes em `app.js` para a verificação ao vivo).
