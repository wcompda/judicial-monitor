---
name: conectar-hermes-claude-codex
description: Guia passo a passo para montar o mesmo ambiente de trabalho da WCOM no computador de outra pessoa — Hermes Agent como central, com o ChatGPT (modelo GPT-5.6 Luna, pelo login da assinatura) como cérebro do Hermes, e o Claude Code e o Codex conectados como "braços" que o Hermes aciona. Instala o que falta, guia cada login (que a própria pessoa faz no navegador), importa as skills do Claude Code para o Hermes, liga o Diário de Ponte (toda conversa lê o que foi feito antes ao começar e deixa registrado o que fez ao terminar, nos três: Hermes, Claude Code e Codex) e faz um teste final. Use quando a pessoa disser "configura meu Hermes", "conecta o Hermes ao Claude Code", "conecta o Codex", "quero usar igual meu pai usa", "montar o ambiente", "instalar o Hermes", "diário de ponte", "ponte diária", "liga a ponte".
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

## Passo 9 — Diário de Ponte (nenhuma conversa se perde)

**O que é:** uma pasta com um arquivo por dia (`~/ponte/2026-11-03.md`, por exemplo). Toda conversa, no Hermes, no Claude Code ou no Codex:

- **ao começar**, lê as últimas anotações da ponte para saber o que já foi feito;
- **ao terminar cada tarefa**, escreve na ponte o que fez e o que ficou pendente.

Assim a próxima conversa, em qualquer uma das três ferramentas, continua de onde a outra parou.

> Seja honesto com a pessoa sobre um limite: nenhuma das três ferramentas "sabe" o momento exato em que a pessoa fecha a janela. Por isso a regra é **escrever na ponte ao terminar cada tarefa**, e não só no fim da conversa. Se a janela for fechada no meio de uma tarefa, aquela tarefa ainda não terá sido anotada.

### 9.1 — Criar a pasta da ponte

Mac/Linux:

```
mkdir -p ~/ponte
```

Windows (PowerShell):

```
mkdir $HOME\ponte
```

### 9.2 — As regras da ponte (o mesmo texto vai para os três)

Este é o texto das regras. Ele vai ser colocado, **igual**, nos três arquivos de instrução global dos passos 9.3, 9.4 e 9.5. Antes de colar, **acrescente no fim do arquivo**: nunca apague o que já existe. Se o arquivo já tiver uma seção "Diário de Ponte", substitua só essa seção.

```markdown
## Diário de Ponte

Existe uma pasta `~/ponte/` com um arquivo por dia (`AAAA-MM-DD.md`). Ela liga todas as
conversas (Hermes, Claude Code e Codex) para nada se perder.

**Ao começar uma conversa:** antes de responder ao primeiro pedido, leia o arquivo de hoje
e o do último dia que existir antes dele (os dois mais recentes da pasta). Se o primeiro
pedido tiver a ver com algo pendente, diga em uma linha o que encontrou ("Na ponte de ontem
ficou pendente X").

**Ao terminar cada tarefa** (não só no fim da conversa), acrescente uma entrada no fim do
arquivo de hoje (crie o arquivo se não existir, com o título `# Ponte AAAA-MM-DD`):

    ## HH:MM — <Hermes | Claude Code | Codex> — <assunto em poucas palavras>
    - Feito: <o que foi feito, em 1 a 3 linhas>
    - Onde: <pastas, arquivos, links, branch>
    - Decidido: <decisões tomadas, se houver>
    - Pendente: <o que falta e o próximo passo; "nada" se terminou>

Quando a pessoa disser "tchau", "encerrar", "acabou por hoje" ou parecido, escreva a entrada
final antes de se despedir.

**Regras:**
- Só acrescente; nunca apague nem reescreva entradas antigas.
- Nunca escreva senhas, códigos de login, tokens, chaves ou dados de cartão na ponte.
- Seja curto: a ponte é um resumo, não uma cópia da conversa.
- Se você foi acionado por outro agente (por exemplo, o Hermes mandou você fazer uma tarefa
  e o pedido diz "tarefa delegada"), **não escreva na ponte**: quem escreve é quem está
  conversando com a pessoa.
- O Hermes, quando delegar algo ao Claude Code ou ao Codex, começa o pedido com
  "(tarefa delegada pelo Hermes — não escreva na ponte)" e depois anota ele mesmo o
  resultado na ponte.
```

### 9.3 — Ponte no Claude Code

1. Acrescente as regras do 9.2 no arquivo de instruções globais do Claude Code:
   - Mac/Linux: `~/.claude/CLAUDE.md`
   - Windows: `C:\Users\<usuário>\.claude\CLAUDE.md`

2. Garanta a leitura automática com um *hook* de início de conversa. O hook roda sozinho e já entrega as últimas anotações para o Claude Code. Edite `~/.claude/settings.json` **juntando** com o que já existe (não apague outras configurações nem outros hooks) e adicione:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo '=== DIARIO DE PONTE (ultimas anotacoes) ==='; for f in $(ls -1 ~/ponte/*.md 2>/dev/null | tail -n 2); do cat \"$f\"; done | tail -n 200"
          }
        ]
      }
    ]
  }
}
```

   No Windows, o Claude Code roda os hooks pelo Git Bash, então o mesmo comando costuma funcionar. Se não funcionar, troque `command` por um equivalente em PowerShell que mostre as últimas 200 linhas dos dois arquivos mais recentes de `$HOME\ponte`. Depois mostre para a pessoa o que mudou no arquivo.

3. Teste: peça para a pessoa abrir uma conversa nova no Claude Code. As anotações da ponte devem aparecer no começo (ou o Claude deve dizer que leu a ponte).

### 9.4 — Ponte no Codex

Acrescente as regras do 9.2 no arquivo de instruções globais do Codex:

- Mac/Linux: `~/.codex/AGENTS.md`
- Windows: `C:\Users\<usuário>\.codex\AGENTS.md`

(Crie o arquivo se não existir. O Codex lê esse arquivo em toda conversa.)

### 9.5 — Ponte no Hermes

Acrescente as regras do 9.2 no `SOUL.md` do Hermes. Ele é carregado em **toda** conversa do Hermes, inclusive pelo Telegram/WhatsApp:

- Mac/Linux/WSL2: `~/.hermes/SOUL.md`
- Windows nativo: o `SOUL.md` fica na pasta de instalação do Hermes (`%LOCALAPPDATA%\hermes`). Confirme o caminho com `hermes --help` ou com a documentação, se não achar.

> Importante: **não** coloque as regras num `AGENTS.md` ou `CLAUDE.md` dentro de pastas de projeto. O Hermes só lê um desses por projeto, e as regras precisam valer em todo lugar. O lugar certo é o `SOUL.md`.

### 9.6 — Teste da ponte

1. No Claude Code: `Crie um arquivo teste-ponte.txt na pasta ~/teste-hermes.` Depois confira se apareceu uma entrada nova em `~/ponte/<hoje>.md`.
2. Feche, abra uma conversa nova **no Hermes** e pergunte: `O que foi feito hoje segundo a ponte?` Ele deve citar o arquivo `teste-ponte.txt`.
3. Repita a pergunta numa conversa nova do Codex.

Se os três responderem certo: ✅ ponte funcionando.

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
| Diário de Ponte: Claude Code (CLAUDE.md + hook) | ✅/❌ |
| Diário de Ponte: Codex (AGENTS.md) | ✅/❌ |
| Diário de Ponte: Hermes (SOUL.md) | ✅/❌ |
| Teste da ponte entre os três | ✅/❌ |

Termine dizendo o próximo passo que faltar, se houver. Nada de lista longa: um passo por vez.

## Problemas comuns

- **`command not found` depois de instalar** → fechar e abrir o terminal.
- **`npm install -g` dá erro de permissão (Mac/Linux)** → não usar `sudo` direto; rode `npm config get prefix` e siga a orientação oficial do npm, ou instale o Node pelo nvm.
- **Login do Hermes com ChatGPT falha com erro de SSL/TLS** → tentar de novo em outra rede (às vezes é o Wi-Fi/antivírus); se continuar, `hermes auth add openai-codex --browser`.
- **Codex diz que não é um repositório git** → rodar dentro de uma pasta com `git init`.
- **A conversa nova não lembrou da ponte** → conferir se as regras estão no arquivo global certo (9.3, 9.4, 9.5) e se a pasta `~/ponte` tem arquivos; no Claude Code, rodar `/hooks` para ver se o hook de início está ativo.
- **A ponte ficou com entradas repetidas** → o Claude Code ou o Codex escreveram numa tarefa delegada pelo Hermes; conferir se o Hermes está começando os pedidos com "(tarefa delegada pelo Hermes — não escreva na ponte)".
- **Hermes não troca de provedor com `/model`** → `/model` só troca entre os já configurados; para configurar um novo, sair (`/quit`) e rodar `hermes model`.
