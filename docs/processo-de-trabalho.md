# Lifetrailer Studio

Sistema pra gerenciar o estudio onde eu trabalho. Integra com a Altegio (plataforma de agendamento que a gente ja usava) e substitui quadro, papel e caderno pelos controles digitais. Nao e produto, e so pra gente mesmo.

Onde estamos: arquitetura, specs e design das telas fechados. Agora e Fase 4, a implementacao: o codigo em src/.

## Como isso foi construido (a partir da Fase 4)

A partir da Fase 4 comecei a usar agente de IA (Claude Code) pra escrever boa parte do codigo. Vai aparecer bastante commit assinado Claude no historico, e as vezes o agente ficou rodando sozinho em background enquanto eu fazia outra coisa.

Nao e pedir pro robo inventar o sistema. Primeiro vem a spec e o ADR, que eu que escrevo e decido. Depois isso vira issue no GitHub ja com escopo definido, e so ai vai pra implementacao. O agente implementa dentro daquele escopo, roda os testes, as vezes eu peco uma revisao em cima do proprio codigo antes de considerar pronto. E quem le, entende e faz o merge pra main sou eu, sempre. Nao entra codigo que eu nao passei o olho.

Vale dizer que boa parte do texto dos specs e ADRs eu escrevi junto com um assistente de chat, nao so o Claude Code na hora do codigo de verdade. Ele escreve o rascunho, as vezes a analise toda, mas a decisao do que realmente vai pro sistema e sempre minha. Se eu nao concordo com o que ele escreveu, eu mudo antes de virar spec.

Uso isso principalmente porque ainda to no 2o periodo da faculdade e sozinho eu nao daria conta de tocar o projeto tao rapido. Mas a parte que decide o que e certo pro sistema (a FSM da Comanda, regra de dinheiro, o que fica pra depois no pendencias.md) essa e minha, nao do agente.

## O que tem em cada pasta

| Pasta | Serve pra | Muda quando |
|---|---|---|
| `docs/adr/` | Registrar decisao importante, uma por arquivo. Nao edito depois de aceito, se mudei de ideia crio outro apontando pro anterior | quase nunca |
| `docs/spec/` | O que o sistema faz hoje. Sem "porque decidi assim", so o "e assim" | toda vez que decido algo novo |
| `docs/pendencias.md` | O que falta decidir, organizado por qual fase trava | toda semana |
| `docs/decisoes-abertas.md` | Regra de dinheiro sem dono ainda, o Wyll que resolve essas | ate ele decidir |
| `data/` | Preco, staff_id, catalogo, tudo em CSV. Nunca escrevo numero direto no texto | quando o mundo real muda |
| `tests/` | Caso de teste que ja roda: `python3 tests/runner.py` | vira codigo na Fase 4 |
| `scripts/` | Coisa que gera outra coisa. Nao e fonte de verdade, so espelha | segue o que ja existe |
| `src/` | Codigo, so na Fase 4 | ainda nao existe |
| `docs/historico/` | Versoes velhas do documento. So pra consulta, morto | nunca mais |

## Regras que eu mesmo criei porque ja quebrei a cara

1. **Numero vem do CSV, nunca do texto.** Ja contei os itens do estoque errado duas vezes seguidas porque o numero tava escrito direto num paragrafo em vez de vir do arquivo. Agora tudo que e contagem, soma ou porcentagem le o CSV na hora.

2. **Spec fala o que. ADR fala por que.** Se eu to escrevendo "porque" dentro da spec, e sinal de que deveria ser um ADR.

3. **ADR aceito nao mexe mais.** Mudei de ideia sobre algo? Escrevo um ADR novo dizendo que revoga o antigo. Nao vou la editar o velho, perde o historico de por que decidi daquele jeito na epoca.

4. **Regra que envolve dinheiro so entra no codigo depois de ter teste cobrindo as leituras possiveis dela.** Dez testes passando nao prova nada se os dez testam a mesma interpretacao errada, foi exatamente o que rolou com o calculo de bloco antes de eu perceber que a regra tinha duas leituras validas.

5. **Status do projeto nao fica documentado como se fosse spec.** Fase, quantos problema ja resolvi, essas coisas, isso nao e parte da arquitetura, e status. Ja misturei os dois antes e gerou tres contradicao de uma vez so.

## Se eu for continuar numa conversa nova (com IA ou nao)

```bash
python3 tests/runner.py                     # roda os testes primeiro
python3 scripts/gerar-contexto.py > CONTEXTO.md
```

Isso junta spec, ADR, testes e pendencia tudo num arquivo so, pra eu nao precisar reexplicar o projeto do zero toda vez. Nao e o documento oficial, e so um resumo gerado. Se eu criar uma spec nova e esquecer de registrar ela no script, ele quebra na hora, melhor travar do que sumir informacao sem eu perceber.

## Quem e quem

| Pessoa | Funcao |
|---|---|
| Helena | Gerente/admin, tem login proprio |
| Wyll | Socio, foi ele que definiu como pensar seguranca aqui |
| Thiago (eu) | Atendente e tambem quem programa (ver ADR 0010 sobre esse conflito) |
| Marcos | Atendente, sempre de manha |
| Paulo | Atendente, tarde/noite, revezando |

Regra de seguranca que o Wyll passou: desenhar pensando num colaborador mal intencionado no futuro, nao confiando so porque a equipe de hoje e de confianca.

Repo e privado. Tem dado real da operacao em `data/`.
