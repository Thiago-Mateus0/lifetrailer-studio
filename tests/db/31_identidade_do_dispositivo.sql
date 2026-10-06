-- (w) A identidade do tablet: chave por aparelho, conferida no banco (ADR 0048).
--
-- O que este arquivo prova, e que nao e obvio:
--   1. a chave em claro so existe na resposta do registro — o banco guarda o
--      hash, e o role da app nao le nem o hash;
--   2. o role da app CONFERE, mas nao REGISTRA nem REVOGA: dar chave nova a um
--      aparelho e ato de quem tem acesso ao banco, nao de quem alcanca a porta;
--   3. revogado deixa de conferir na hora, sem apagar a linha.
begin;
select plan(13);
\ir _fixtures.psql

select has_table('dispositivo', 'a tabela dispositivo existe');
select has_function('app', 'dispositivo_registrar', 'app.dispositivo_registrar() existe');
select has_function('app', 'dispositivo_conferir',  'app.dispositivo_conferir() existe');
select has_function('app', 'dispositivo_revogar',   'app.dispositivo_revogar() existe');

select app.dispositivo_registrar('Tablet Recepcao') as chave \gset

select ok(length(:'chave') >= 43, 'a chave tem ao menos 32 bytes de entropia (43 caracteres base64url)');
select is((select count(*)::int from dispositivo where token_hash = :'chave'), 0,
  'a chave em claro NAO fica gravada');

select is((app.dispositivo_conferir(:'chave')) ->> 'nome', 'Tablet Recepcao',
  'a chave certa confere e diz qual aparelho e');
select is((app.dispositivo_conferir('chave-que-nao-existe')) ->> 'ok', 'false',
  'chave errada nao confere');
select is((app.dispositivo_conferir(null)) ->> 'ok', 'false',
  'chave ausente nao confere, e nao estoura');

select throws_ok(
  $$ select app.dispositivo_registrar('Tablet Recepcao') $$,
  '23505', null, 'dois aparelhos com o mesmo nome nao — o nome e o que aparece na investigacao');

select app.dispositivo_revogar('Tablet Recepcao');
select is((app.dispositivo_conferir(:'chave')) ->> 'ok', 'false',
  'revogado deixa de conferir na hora');

-- ================================================================ as portas
select ok(
  has_function_privilege('lifetrailer_app', 'app.dispositivo_conferir(text)', 'execute')
  and not has_function_privilege('lifetrailer_app', 'app.dispositivo_registrar(text)', 'execute')
  and not has_function_privilege('lifetrailer_app', 'app.dispositivo_revogar(text)', 'execute'),
  'o role da app confere, mas nao registra nem revoga aparelho');
select ok(
  not has_column_privilege('lifetrailer_app', 'dispositivo', 'token_hash', 'select'),
  'o role da app NAO le token_hash');

select * from finish();
rollback;
