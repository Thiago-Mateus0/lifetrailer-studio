// O cliente da API do ManyChat que o botão Enviar da Jana usa (ADR 0076).
//
// Só duas perguntas: quem é o contato com este telefone, e mande este texto a
// ele. O contato é achado pelo campo `telefone_whatsapp`, que o fluxo da
// Resposta padrão preenche com o WhatsApp ID — só dígitos, sem `+`, o mesmo
// formato do `cliente_telefone` da Altegio (teste da issue #221).
//
// Texto e não arquivo: a API responde `success` a um arquivo no WhatsApp e não
// entrega (issue #194). O PDF vai como link.

export const CAMPO_TELEFONE = 'telefone_whatsapp';

const BASE = 'https://api.manychat.com';
const PRAZO_MS = 10_000;

export const soDigitos = (telefone) => String(telefone ?? '').replace(/\D/g, '');

export function criarManychat({ token, buscar = fetch, base = BASE }) {
  // O id do campo é da conta, não do código: lido pelo nome uma vez e guardado.
  let campoId = null;

  async function chamar(caminho, { busca, corpo } = {}) {
    const url = `${base}${caminho}${busca ? `?${new URLSearchParams(busca)}` : ''}`;
    const resposta = await buscar(url, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(PRAZO_MS),
    });
    const dados = await resposta.json().catch(() => null);
    return dados ?? { status: 'error', message: `HTTP ${resposta.status}` };
  }

  async function idDoCampo() {
    if (campoId !== null) return campoId;
    const r = await chamar('/fb/page/getCustomFields');
    if (r.status !== 'success') throw new Error(`manychat: getCustomFields: ${r.message ?? 'erro'}`);
    const campo = r.data.find((c) => c.name === CAMPO_TELEFONE);
    if (campo === undefined) throw new Error(`manychat: o campo ${CAMPO_TELEFONE} nao existe na conta`);
    campoId = campo.id;
    return campoId;
  }

  return {
    /** Os ids dos contatos cujo `telefone_whatsapp` é exatamente `telefone`. */
    async acharContatos(telefone) {
      const r = await chamar('/fb/subscriber/findByCustomField', {
        busca: { field_id: await idDoCampo(), field_value: telefone },
      });
      if (r.status !== 'success') throw new Error(`manychat: findByCustomField: ${r.message ?? 'erro'}`);
      return r.data.map((c) => String(c.id));
    },

    /** `{ ok: true }` só quando o ManyChat aceitou; senão o que ele disse. */
    async enviarTexto(contatoId, texto) {
      const r = await chamar('/fb/sending/sendContent', {
        corpo: {
          subscriber_id: contatoId,
          data: { version: 'v2', content: { type: 'whatsapp', messages: [{ type: 'text', text: texto }] } },
        },
      });
      return r.status === 'success' ? { ok: true } : { ok: false, mensagem: r.message ?? 'erro' };
    },
  };
}
