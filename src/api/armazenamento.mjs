// Onde os bytes da foto ficam (ADR 0051 §1).
//
// Dois métodos, nenhum a mais:
//
//   guardar(chave, bytes)  grava; não devolve nada
//   ler(chave)             devolve o Buffer, ou null se não existir
//
// `apagar` é do job de retenção do ADR 0023 §5, que ainda não existe — método
// sem chamador é superfície sem dono, a mesma regra da allow-list do ADR 0042.
//
// O R2 (ADR 0016) implementa os mesmos dois métodos quando a credencial existir,
// e nem a rota nem a função do banco mudam por isso. É por causa dessa troca que
// `midia.url` guarda a CHAVE e não um endereço: a linha é write-once.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

// A chave é montada por nós a partir de um uuid, então isto nunca deveria
// disparar. Existe porque a consequência de errar é escrever fora da pasta, e a
// conferência custa uma linha — não porque há caminho conhecido até aqui.
function conferirChave(chave) {
  if (typeof chave !== 'string' || chave === '') throw new Error('midia: chave vazia');
  const partes = chave.split('/');
  if (chave.startsWith('/') || partes.includes('..') || partes.includes('')) {
    throw new Error(`midia: chave suspeita: ${chave}`);
  }
}

export function armazenamentoEmDisco(raiz) {
  const caminhoDe = (chave) => {
    conferirChave(chave);
    return join(raiz, ...chave.split('/'));
  };

  return {
    async guardar(chave, bytes) {
      const caminho = caminhoDe(chave);
      await mkdir(dirname(caminho), { recursive: true });
      // 'wx': falha se o arquivo já existe. Mídia é write-once, e sobrescrever
      // silenciosamente é o único jeito de perder uma foto por aqui.
      await writeFile(caminho, bytes, { flag: 'wx' });
    },

    async ler(chave) {
      try {
        return await readFile(caminhoDe(chave));
      } catch (erro) {
        // Arquivo que não está lá é resposta, não exceção: quem chama decide se
        // isso é 404 ou referência quebrada. Qualquer outro erro sobe.
        if (erro.code === 'ENOENT') return null;
        throw erro;
      }
    },

    // Aparece no log de boot pra que "em que pasta isto está gravando" não
    // dependa de ler o código.
    descricao: `disco em ${raiz}${sep}`,
  };
}
