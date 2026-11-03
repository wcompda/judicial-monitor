# Como usar esta skill (para quem vai configurar)

Você vai precisar de:

- Sua conta **Claude** (a que você usa no Claude Code).
- Sua conta **ChatGPT** com assinatura (é ela que faz o "Luna" funcionar).
- O **Claude Code** aberto no seu computador.

## 1. Colocar a skill no seu Claude Code

Crie a pasta e salve o arquivo `SKILL.md` dentro dela:

- Mac/Linux: `~/.claude/skills/conectar-hermes-claude-codex/SKILL.md`
- Windows: `C:\Users\SEU-USUARIO\.claude\skills\conectar-hermes-claude-codex\SKILL.md`

Jeito mais fácil: abra o Claude Code, cole o conteúdo do `SKILL.md` e escreva
"Salva isso como uma skill minha em ~/.claude/skills/conectar-hermes-claude-codex/SKILL.md".

Feche e abra o Claude Code de novo.

## 2. Pedir para ele fazer

No Claude Code, escreva:

> **Configura meu Hermes conectado ao Claude Code e ao Codex, com o Diário de Ponte, igual meu pai usa.**

O **Diário de Ponte** é uma pasta (`ponte`) com um arquivo por dia. Toda conversa, seja no
Hermes, no Claude Code ou no Codex, lê o que foi feito antes quando começa e anota o que
fez quando termina cada tarefa. Assim você pode fechar uma conversa e abrir outra (até
em outra ferramenta) sem perder o fio.

Ele vai seguir passo a passo. Quando chegar num **login**, ele vai pedir para você
abrir um terminal e rodar um comando — você entra com **a sua conta** no navegador e
responde "pronto".

**Nunca cole senha ou código de login no chat.** O login é sempre você que faz.

## 3. No fim

Ele mostra uma tabela com ✅ em tudo. Se algo ficar ❌, é só pedir:
"continua de onde parou".
