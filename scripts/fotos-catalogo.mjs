// Lista das fotos de catálogo (ADR 0065): quais itens já têm foto, quais faltam,
// e em que tela cada uma aparece. Sai dos CSVs na hora — é a lista de fotos a tirar.
//
//   node scripts/fotos-catalogo.mjs             lista
//   node scripts/fotos-catalogo.mjs --encolher  ajeita o que foi jogado na pasta:
//     renomeia pelo nome do item ("Doritos 32g.png" → doritos-32g.jpg) e reduz
//     o que passa do teto. Precisa do ImageMagick (`convert`).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lerCsv } from '../src/db/carga.mjs';
import { arquivoDaFoto, LADO_FOTO, TETO_FOTO_BYTES } from '../src/app/src/fotoDoCatalogo.ts';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PASTA = join(RAIZ, 'src/app/src/imagens/catalogo');

// A Bomboniere é uma tabela só pra Comanda e pro Estoque: uma foto, duas telas.
const CATALOGOS = [
  { csv: 'bomboniere.csv', titulo: 'Bomboniere', telas: 'Comanda (extras) e Estoque (bomboniere)' },
  { csv: 'fundos-equipamentos.csv', titulo: 'Fundos e equipamentos', telas: 'Comanda (extras)' },
  { csv: 'insumos.csv', titulo: 'Insumos', telas: 'Estoque (conferir e compra)' },
];

const naPasta = () => readdirSync(PASTA).filter((arquivo) => arquivo !== '.gitkeep');

function encolher() {
  for (const arquivo of naPasta()) {
    const destino = arquivoDaFoto(arquivo.slice(0, -extname(arquivo).length || undefined));
    const origem = join(PASTA, arquivo);
    if (destino === arquivo && statSync(origem).size <= TETO_FOTO_BYTES) continue;
    try {
      execFileSync('convert', [origem, '-auto-orient', '-resize', `${LADO_FOTO}x${LADO_FOTO}>`, '-strip', '-quality', '80', join(PASTA, destino)]);
    } catch (erro) {
      console.log(`✗ ${arquivo}: não converteu (${erro.code === 'ENOENT' ? 'ImageMagick não instalado' : 'formato não suportado?'})`);
      continue;
    }
    if (destino !== arquivo) unlinkSync(origem);
    console.log(`✓ ${arquivo} → ${destino} (${Math.round(statSync(join(PASTA, destino)).size / 1024)} KB)`);
  }
}

function listar() {
  const presentes = new Map(naPasta().map((arquivo) => [arquivo, statSync(join(PASTA, arquivo)).size]));
  const usadas = new Set();
  let prontas = 0;
  let total = 0;

  for (const catalogo of CATALOGOS) {
    const itens = lerCsv(readFileSync(join(RAIZ, 'data', catalogo.csv), 'utf8')).filter((linha) => linha.ativo === 'true');
    console.log(`\n${catalogo.titulo} — aparece em ${catalogo.telas}`);
    for (const { nome } of itens) {
      const arquivo = arquivoDaFoto(nome);
      const bytes = presentes.get(arquivo);
      // Mesmo arquivo em dois catálogos = mesma foto nos dois: avisa, porque
      // pode ser de propósito ou dois itens diferentes com o mesmo nome.
      const repetida = usadas.has(arquivo) ? '  ← mesma foto de um item acima' : '';
      usadas.add(arquivo);
      if (repetida === '') total += 1;
      if (bytes === undefined) console.log(`  [ ] ${nome}  →  ${arquivo}${repetida}`);
      else if (bytes > TETO_FOTO_BYTES) console.log(`  [!] ${nome}  →  ${arquivo}: ${Math.round(bytes / 1024)} KB, rode --encolher${repetida}`);
      else {
        console.log(`  [x] ${nome}${repetida}`);
        if (repetida === '') prontas += 1;
      }
    }
  }

  const sobrando = [...presentes.keys()].filter((arquivo) => !usadas.has(arquivo));
  if (sobrando.length > 0) console.log(`\nNa pasta sem item correspondente (nome errado?): ${sobrando.join(', ')}`);
  console.log(`\n${prontas} de ${total} fotos prontas. Pasta: src/app/src/imagens/catalogo/`);
}

if (process.argv.includes('--encolher')) encolher();
else listar();
