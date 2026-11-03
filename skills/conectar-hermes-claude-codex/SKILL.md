---
name: conectar-hermes-claude-codex
description: Guia passo a passo para montar o mesmo ambiente de trabalho da WCOM no computador de outra pessoa — Hermes Agent como central, com o ChatGPT (modelo GPT-5.6 Luna, pelo login da assinatura) como cérebro do Hermes, e o Claude Code e o Codex conectados como "braços" que o Hermes aciona. Instala o que falta, guia cada login (que a própria pessoa faz no navegador), importa as skills do Claude Code para o Hermes e faz um teste final. Use quando a pessoa disser "configura meu Hermes", "conecta o Hermes ao Claude Code", "conecta o Codex", "quero usar igual meu pai usa", "montar o ambiente", "instalar o Hermes".
---

# Conectar Hermes + Claude Code + Codex (jeito WCOM)

Você está ajudando uma pessoa a montar no computador dela o mesmo ambiente que a WCOM usa:

```
                 ┌──────────────────────────────┐
  pedido  ──►    │  HERMES (central)            │
                 │  cérebro: ChatGPT / Luna     │
                 └──────┬──────────────┬────────┘
                        │              │
              skill claude-code   skill codex
                        ▼              ▼
                 ┌────────────┐  ┌────────────┐
                 │ CLAUDE CODE│  │   CODEX    │
                 │ conta Claude│ │ conta ChatGPT│
                 └────────────┘  └────────────┘
```

- **Hermes** recebe os pedidos e decide quem faz o quê.
- **Cérebro do Hermes = ChatGPT (GPT-5.6 Luna)**, pelo login da assinatura ChatGPT da pessoa.
- **Claude Code** e **Codex** são acionados pelo Hermes (skills `claude-code` e `codex`, que já vêm com o Hermes).

Cada pessoa usa **as próprias contas** (Claude e ChatGPT). Nunca use contas de outra pessoa.

## Regras (siga sempre)

1. **Fale simples**, em português, um passo de cada vez. Diga o que vai fazer antes de rodar.
2. **Nunca peça senha, código, token ou chave no chat.** Todo login é feito pela própria pessoa, no navegador ou no terminal dela. Se ela colar um segredo no chat, avise para trocar.
3. **Comandos de login são interativos** (abrem navegador ou pedem para digitar um código). Peça para a pessoa rodar esses comandos **num terminal separado, aberto por ela**, e responder "pronto" quando terminar. Os outros comandos você pode rodar.
4. **Não invente comandos.** Se algo não bater com o que está aqui (versão nova, menu com outro nome), rode `hermes --help`, `hermes <comando> --help`, `codex --help` ou `claude --help` e siga o que aparecer.
5. **Confira cada passo** antes de ir para o próximo (comando de verificação no fim de cada etapa).
6. No fim, mostre um resumo com ✅ / ❌ de cada item.

---

## Passo 0 — Descobrir o computador

Rode e veja o sistema:

- Mac/Linux: `uname -s` (Darwin = Mac, Linux = Linux)
- Windows: o Claude Code avisa que é Windows; confirme com `echo $env:OS` no PowerShell.

Confira também o Node.js (precisa para o Codex):

```
node --version
npm --version
```

Se não tiver Node (ou for menor que 20): peça para a pessoa instalar a versão **LTS** em https://nodejs.org, fechar e abrir o terminal, e confirmar com `node --version`.

## Passo 1 — Claude Code (já tem conta)

```
claude --version
claude auth status --text
```

- Se mostrar que está logado: ✅ siga.
- Se não estiver logado: peça para a pessoa abrir um terminal, rodar `claude`, digitar `/login` e entrar com a conta Claude dela no navegador.

## Passo 2 — Codex (conta ChatGPT)

Instalar:

```
npm install -g @openai/codex
codex --version
```

Login (a pessoa faz, num terminal separado):

```
codex login
```

Ela escolhe **"Sign in with ChatGPT"** e entra com a conta ChatGPT dela no navegador.

Conferir:

```
codex login status
```

## Passo 3 — Instalar o Hermes

Mac, Linux ou Windows com WSL2:

```
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

Windows (PowerShell normal):

```
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

Depois peça para a pessoa **fechar e abrir o terminal** (ou rodar `source ~/.bashrc` / `source ~/.zshrc`) e confira:

```
hermes --version
```

Se o instalador abrir o assistente `hermes setup` sozinho, deixe a pessoa seguir e, quando perguntar o provedor de IA, use o Passo 4 abaixo.

## Passo 4 — Ligar o cérebro do Hermes no ChatGPT (Luna)

A pessoa roda, num terminal separado:

```
hermes model
```

No menu:

1. Escolher **"ChatGPT or Codex Subscription"**.
2. Vai aparecer um **link e um código**. Ela abre o link, entra com a conta ChatGPT e digita o código.
3. Na lista de modelos, escolher o que tiver **`luna`** no nome (ex.: `gpt-5.6-luna`). Se não aparecer, escolher o modelo padrão sugerido e avisar.

Atalho equivalente para só fazer o login: `hermes auth add openai-codex`.

> Observação: o login do Hermes e o login do Codex são **separados** (um fica em `~/.hermes/auth.json`, o outro em `~/.codex/auth.json`). Por isso o Passo 2 e o Passo 4 são os dois necessários.

> Por que o cérebro é o ChatGPT e não o Claude: o Hermes só aceita a conta Claude como cérebro no plano **Max com créditos extras comprados**; no plano **Pro não funciona**. O Claude Code continua sendo usado normalmente pelo Hermes através da skill `claude-code`, com o login próprio do Claude Code (Passo 1).

## Passo 5 — Conferir as skills que ligam o Hermes ao Claude Code e ao Codex

```
hermes skills list
```

Precisam aparecer **`claude-code`** e **`codex`** (vêm junto com o Hermes). Se não aparecerem, rode `hermes skills --help` e procure como instalar/ativar as skills que vêm junto com o Hermes (bundled).

## Passo 6 — Levar as skills e instruções do Claude Code para o Hermes

Primeiro só uma prévia (não muda nada):

```
hermes import-agent claude-code --dry-run
```

Mostre para a pessoa o que vai entrar. Se ela concordar:

```
hermes import-agent claude-code
```

Assim as skills que ela já tem no Claude Code (em `~/.claude/skills/`) passam a valer também no Hermes (ficam em `~/.hermes/skills/`).

## Passo 7 — Teste final

Criar uma pasta de teste (o Codex só trabalha dentro de uma pasta com git):

Mac/Linux:

```
mkdir -p ~/teste-hermes && cd ~/teste-hermes && git init
```

Windows (PowerShell):

```
mkdir $HOME\teste-hermes; cd $HOME\teste-hermes; git init
```

Peça para a pessoa abrir o Hermes nessa pasta (`hermes`) e mandar, um de cada vez:

1. `Use a skill claude-code para criar um arquivo ola-claude.txt escrito "Claude funcionando".`
2. `Use a skill codex para criar um arquivo ola-codex.txt escrito "Codex funcionando".`

Depois confira se os dois arquivos existem na pasta. Se der erro, rode `hermes doctor` e leia a mensagem com a pessoa.

## Passo 8 (opcional) — Falar com o Hermes pelo celular

Só se a pessoa quiser usar pelo Telegram/WhatsApp:

```
hermes gateway setup
hermes gateway start
```

Siga o assistente na tela. Para aprovar quem pode falar com o bot: `hermes pairing list`.

---

## Resumo final (mostre assim)

| Item | Status |
|---|---|
| Node.js | ✅/❌ |
| Claude Code logado | ✅/❌ |
| Codex instalado e logado (ChatGPT) | ✅/❌ |
| Hermes instalado | ✅/❌ |
| Cérebro do Hermes = ChatGPT (Luna) | ✅/❌ |
| Skills `claude-code` e `codex` no Hermes | ✅/❌ |
| Skills do Claude Code importadas | ✅/❌ |
| Teste Claude + Codex pelo Hermes | ✅/❌ |

Termine dizendo o próximo passo que faltar, se houver. Nada de lista longa: um passo por vez.

## Problemas comuns

- **`command not found` depois de instalar** → fechar e abrir o terminal.
- **`npm install -g` dá erro de permissão (Mac/Linux)** → não usar `sudo` direto; rode `npm config get prefix` e siga a orientação oficial do npm, ou instale o Node pelo nvm.
- **Login do Hermes com ChatGPT falha com erro de SSL/TLS** → tentar de novo em outra rede (às vezes é o Wi-Fi/antivírus); se continuar, `hermes auth add openai-codex --browser`.
- **Codex diz que não é um repositório git** → rodar dentro de uma pasta com `git init`.
- **Hermes não troca de provedor com `/model`** → `/model` só troca entre os já configurados; para configurar um novo, sair (`/quit`) e rodar `hermes model`.
