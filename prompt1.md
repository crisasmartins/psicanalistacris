"Você vai criar o banco de dados para um sistema de gestão de consultório de psicanálise. O projeto já foi criado com o nome de 'Projeto Psicanalise'. Crie toda a estrutura do banco de dados (PostgreSQL), preferencialmente utilizando a conexão direta se disponível (via MCP) ou gerando o script SQL.


Crie as seguintes tabelas com os campos abaixo:

# Tabela psicanalistas
id (uuid, primary key, gerado automaticamente)
nome (text, not null)
email (text, not null, unique)
created_at (timestamp, gerado automaticamente)
# Tabela pacientes
id (uuid, primary key, gerado automaticamente)
psicanalista_id (uuid, foreign key → psicanalistas.id)
nome_completo (text, not null)
cpf (text, not null, unique)
whatsapp (text)
email (text)
created_at (timestamp, gerado automaticamente)
# Tabela consultas
id (uuid, primary key, gerado automaticamente)
paciente_id (uuid, foreign key → pacientes.id)
data_hora (timestamp, not null)
status (text, default 'agendado') -- [agendado, pago, cancelado, realizado]
valor_pago (numeric)
observacoes (text) -- Área reservada para anotações clínicas
created_at (timestamp, gerado automaticamente)
# Tabela horarios_disponiveis
id (uuid, primary key, gerado automaticamente)
psicanalista_id (uuid, foreign key → psicanalistas.id)
dia_semana (integer) -- 0 a 6
hora_inicio (time, not null)
hora_fim (time, not null)
data_bloqueio (date, nullable) -- Para férias ou feriados
Após criar todas as tabelas e relacionamentos, ative o Row Level Security (RLS) em todas as tabelas para garantir que cada psicanalista acesse apenas os seus próprios dados e de seus pacientes, mantendo a privacidade clínica. Configure as políticas necessárias.

Por fim, confirme que tudo foi criado corretamente listando as tabelas e seus campos."-----Dica: Como você mencionou que precisa de um local "seguro e protegido" para as informações, este prompt estruturado já considera a separação por psicanalista_id e a segurança via RLS, o que é fundamental para o cumprimento dos requisitos que você levantou na nossa conversa anterior. 
