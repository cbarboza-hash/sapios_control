/* =====================================================================
   supabase-api.js
   Camada de integração do Suporte Control com o Supabase.
   Expõe window.SC_API. O front não fala com o Supabase diretamente,
   só chama as funções daqui.

   1) Preencha SUPABASE_URL e SUPABASE_ANON_KEY (Supabase > Project
      Settings > API). A chave "anon" é pública por design: quem protege
      os dados é o RLS do banco + o login. NUNCA use a service_role aqui.
   2) Carregue este arquivo depois do supabase-js (ver suporte-control.html).
   ===================================================================== */
(function () {
  const SUPABASE_URL = 'https://sextezshzlcbvyckvjgu.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNleHRlenNoemxjYnZ5Y2t2amd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NjAzNTUsImV4cCI6MjEwNjQzNjM1NX0.P4as9IbWMkUOsQuQOdxQA0D-SgCtATcv07Tq3r2Hx3A';

  const configured =
    !!window.supabase &&
    !SUPABASE_URL.includes('SEU-PROJETO') &&
    !SUPABASE_ANON_KEY.includes('SUA-CHAVE');

  const sb = configured
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  /* ---------- helpers ---------- */

  const ok = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  // Converte linhas do banco para o formato utilizado pelo front-end.
  const P = r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    client: r.client,
    owner: r.owner,
    status: r.status,
    notes: r.notes || '',
    notesUpdatedAt: r.notes_updated_at || null,
    createdAt: r.created_at
  });

  const T = r => ({
    id: r.id,
    projectId: r.project_id,
    description: r.description,
    owner: r.owner,
    estimateMin: r.estimate_min,
    createdAt: r.created_at,
    status: r.status,
    completedAt: r.completed_at,
    finalMinutes: r.final_minutes
  });

  const E = r => ({
    id: r.id,
    topicId: r.topic_id,
    date: r.work_date,
    minutes: r.minutes,
    owner: r.owner,
    note: r.note || ''
  });

  const D = r => ({
    id: r.id,
    projectId: r.project_id,
    description: r.description,
    dueDate: r.due_date,
    deliveredAt: r.delivered_at || null,
    createdAt: r.created_at
  });

  // Converte alterações do front-end para colunas do banco.
  function toRow(patch, map) {
    const out = {};
    for (const k of Object.keys(patch)) {
      if (k in map) out[map[k]] = patch[k];
    }
    return out;
  }

  const TOPIC_COLS = {
    description: 'description',
    owner: 'owner',
    estimateMin: 'estimate_min',
    status: 'status',
    completedAt: 'completed_at'
  };

  const ENTRY_COLS = {
    date: 'work_date',
    minutes: 'minutes',
    owner: 'owner',
    note: 'note'
  };

  // Busca registros em páginas para não ultrapassar o limite do Supabase.
  async function fetchAll(table, orderCols) {
    const size = 1000;
    let from = 0;
    let out = [];

    for (;;) {
      let q = sb.from(table).select('*');

      for (const c of orderCols) {
        q = q.order(c, { ascending: true });
      }

      const data = ok(await q.range(from, from + size - 1));
      out = out.concat(data);

      if (data.length < size) break;
      from += size;
    }

    return out;
  }

  function newCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    let s = '';

    for (let i = 0; i < 4; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }

    return `PRJ-${new Date().getFullYear()}-${s}`;
  }

  // Mensagens amigáveis para erros do Supabase.
  function explain(e) {
    const msg = (e && e.message) || String(e);

    if (e && e.code === '23503') {
      return 'Este item está em uso e não pode ser removido.';
    }

    if (e && e.code === '23505') {
      return 'Já existe um registro igual.';
    }

    if (e && (e.code === '42501' || /row-level security/i.test(msg))) {
      return 'Sem permissão para esta ação. Saia e entre novamente.';
    }

    if (/jwt|expired/i.test(msg)) {
      return 'Sua sessão expirou. Saia e entre de novo.';
    }

    if (/failed to fetch|network/i.test(msg)) {
      return 'Sem conexão com o Supabase. Verifique a internet.';
    }

    return 'Não foi possível concluir: ' + msg;
  }

  /* ---------- API ---------- */

  const api = {
    configured,
    explain,

    // Autenticação.
    auth: {
      async session() {
        const { data, error } = await sb.auth.getSession();
        if (error) throw error;
        return data.session;
      },

      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;
        return data.user;
      },

      async signOut() {
        const { error } = await sb.auth.signOut();
        if (error) throw error;
      },

      onChange(cb) {
        sb.auth.onAuthStateChange((event, session) => {
          cb(event, session);
        });
      }
    },

    // Carrega os dados utilizados pelo painel.
    async loadAll() {
      const [team, clients, projects, topics, entries, pendencies] =
        await Promise.all([
          fetchAll('team_members', ['name']),
          fetchAll('clients', ['name']),
          fetchAll('projects', ['created_at', 'code']),
          fetchAll('topics', ['created_at', 'id']),
          fetchAll('entries', ['work_date', 'id']),
          fetchAll('pendencies', ['due_date', 'created_at'])
        ]);

      return {
        team: team.map(r => r.name),
        clients: clients.map(r => r.name),
        projects: projects.map(P),
        topics: topics.map(T),
        entries: entries.map(E),
        pendencies: pendencies.map(D)
      };
    },

    // Cadastro e remoção da equipe.
    team: {
      async add(name) {
        ok(await sb.from('team_members').insert({
          name: name.trim()
        }));
      },

      async remove(name) {
        ok(await sb.from('team_members').delete().eq('name', name));
      }
    },

    // Cadastro e remoção de clientes.
    clients: {
      async add(name) {
        ok(await sb.from('clients').insert({
          name: name.trim()
        }));
      },

      async remove(name) {
        ok(await sb.from('clients').delete().eq('name', name));
      }
    },

    // Projetos e observações.
    projects: {
      async create({ name, client, owner, createdAt }) {
        for (let i = 0; i < 5; i++) {
          const { data, error } = await sb
            .from('projects')
            .insert({
              code: newCode(),
              name,
              client,
              owner,
              created_at: createdAt
            })
            .select()
            .single();

          if (!error) return P(data);

          if (error.code !== '23505') throw error;
        }

        throw new Error('Não foi possível gerar um código de projeto único.');
      },

      async setStatus(id, status) {
        return P(ok(await sb
          .from('projects')
          .update({ status })
          .eq('id', id)
          .select()
          .single()));
      },

      // Salva ou atualiza as observações do projeto.
      async updateNotes(id, notes) {
        return P(ok(await sb
          .from('projects')
          .update({ notes })
          .eq('id', id)
          .select()
          .single()));
      },

      async remove(id) {
        ok(await sb.from('projects').delete().eq('id', id));
      }
    },

    // Tópicos dos projetos.
    topics: {
      async create(projectId, {
        description,
        owner,
        estimateMin,
        createdAt
      }) {
        return T(ok(await sb
          .from('topics')
          .insert({
            project_id: projectId,
            description,
            owner,
            estimate_min: estimateMin,
            created_at: createdAt
          })
          .select()
          .single()));
      },

      async update(id, patch) {
        return T(ok(await sb
          .from('topics')
          .update(toRow(patch, TOPIC_COLS))
          .eq('id', id)
          .select()
          .single()));
      },

      async complete(id, completedAt) {
        return api.topics.update(id, {
          status: 'done',
          completedAt
        });
      },

      async reopen(id) {
        return api.topics.update(id, {
          status: 'open'
        });
      },

      async remove(id) {
        ok(await sb.from('topics').delete().eq('id', id));
      }
    },

    // Pendências: descrição, data prevista e data real da entrega.
    // Não utiliza estimativa de horas.
    pendencies: {
      async create(projectId, { description, dueDate, createdAt }) {
        return D(ok(await sb
          .from('pendencies')
          .insert({
            project_id: projectId,
            description: description.trim(),
            due_date: dueDate,
            created_at: createdAt
          })
          .select()
          .single()));
      },

      async update(id, patch) {
        const row = {};

        if ('description' in patch) {
          row.description = patch.description.trim();
        }

        if ('dueDate' in patch) {
          row.due_date = patch.dueDate;
        }

        // Quando entregue, salva a data real.
        // Para desmarcar a entrega, envie deliveredAt: null.
        if ('deliveredAt' in patch) {
          row.delivered_at = patch.deliveredAt || null;
        }

        return D(ok(await sb
          .from('pendencies')
          .update(row)
          .eq('id', id)
          .select()
          .single()));
      },

      async remove(id) {
        ok(await sb.from('pendencies').delete().eq('id', id));
      }
    },

    // Lançamentos de horas dos tópicos.
    entries: {
      async create(topicId, { date, minutes, owner, note }) {
        return E(ok(await sb
          .from('entries')
          .insert({
            topic_id: topicId,
            work_date: date,
            minutes,
            owner,
            note
          })
          .select()
          .single()));
      },

      async update(id, patch) {
        return E(ok(await sb
          .from('entries')
          .update(toRow(patch, ENTRY_COLS))
          .eq('id', id)
          .select()
          .single()));
      },

      async remove(id) {
        ok(await sb.from('entries').delete().eq('id', id));
      }
    }
  };

  window.SC_API = api;
})();
