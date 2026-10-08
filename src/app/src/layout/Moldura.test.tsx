import { render as renderizar, screen as tela } from '@testing-library/react';
import { describe as descrever, expect as esperar, test as testar } from 'vitest';
import { Moldura } from './Moldura';

descrever('Moldura', () => {
  testar.each([
    {
      descricao: 'com sala e iniciais do turno',
      sala: 'Acústico',
      turno: 'JW',
      partes: ['LIFETRAILER', 'Início', 'Acústico', 'JW', '08:12'],
    },
    {
      descricao: 'somente com sala',
      sala: 'Acústico',
      turno: undefined,
      partes: ['LIFETRAILER', 'Início', 'Acústico', '08:12'],
    },
    {
      descricao: 'somente com iniciais do turno',
      sala: undefined,
      turno: 'JW',
      partes: ['LIFETRAILER', 'Início', 'JW', '08:12'],
    },
    {
      descricao: 'sem opcionais',
      sala: undefined,
      turno: undefined,
      partes: ['LIFETRAILER', 'Início', '08:12'],
    },
    {
      descricao: 'com opcionais vazios',
      sala: '',
      turno: '',
      partes: ['LIFETRAILER', 'Início', '08:12'],
    },
    {
      descricao: 'com opcionais contendo apenas espaços',
      sala: ' \t ',
      turno: ' \n ',
      partes: ['LIFETRAILER', 'Início', '08:12'],
    },
    {
      descricao: 'com sala e iniciais em branco',
      sala: 'Acústico',
      turno: ' ',
      partes: ['LIFETRAILER', 'Início', 'Acústico', '08:12'],
    },
    {
      descricao: 'com sala em branco e iniciais do turno',
      sala: ' ',
      turno: 'JW',
      partes: ['LIFETRAILER', 'Início', 'JW', '08:12'],
    },
  ])('mantém a assinatura em ordem e sem separadores órfãos $descricao', ({ sala, turno, partes }) => {
    renderizar(
      <Moldura contexto="Início" hora="08:12" sala={sala} turno={turno}>
        <h1>Recepção</h1>
      </Moldura>,
    );

    const faixa = tela.getByRole('banner', { name: 'Identificação da tela' });
    const partesRenderizadas = faixa.textContent?.split('·').map((parte) => parte.trim());

    esperar(partesRenderizadas).toEqual(partes);
  });

  testar('exibe o conteúdo recebido na região principal', () => {
    renderizar(
      <Moldura contexto="Início" hora="08:12">
        <h1>Recepção</h1>
        <p>Conteúdo da tela.</p>
      </Moldura>,
    );

    const principal = tela.getByRole('main');

    esperar(principal).toContainElement(tela.getByRole('heading', { name: 'Recepção' }));
    esperar(principal).toHaveTextContent('Conteúdo da tela.');
  });

  testar('identifica a hora semanticamente e oculta separadores decorativos da acessibilidade', () => {
    renderizar(
      <Moldura contexto="Início" hora="08:12" sala="Acústico" turno="JW">
        <h1>Recepção</h1>
      </Moldura>,
    );

    const hora = tela.getByText('08:12');

    esperar(hora.tagName).toBe('TIME');
    esperar(hora).toHaveAttribute('datetime', '08:12');

    for (const separador of tela.getAllByText('·')) {
      esperar(separador).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
