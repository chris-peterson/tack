export const ZSH_COMPLETION = `#compdef tack

_tack_routes() {
  local tack_dir="\${TACK_HOME:-$HOME/.tack}/routes"
  [[ -d "$tack_dir" ]] || return
  local -a routes
  routes=( "$tack_dir"/*.yaml(N:t:r) )
  (( \${#routes} )) && compadd -a routes
}

_tack_tack_ids() {
  local slug="$1"
  local tack_dir="\${TACK_HOME:-$HOME/.tack}/routes"
  local route_file="$tack_dir/$slug.yaml"
  [[ -f "$route_file" ]] || return
  local -a ids descs
  local id summary
  while IFS= read -r line; do
    if [[ "$line" =~ '^  - id: (.+)' ]]; then
      id="\${match[1]}"
    elif [[ -n "$id" && "$line" =~ '^    summary: (.+)' ]]; then
      summary="\${match[1]}"
      ids+=("$id")
      descs+=("$id:$summary")
      id=""
    fi
  done < "$route_file"
  if (( \${#descs} )); then
    _describe 'tack' descs
  elif (( \${#ids} )); then
    compadd -a ids
  fi
}

_tack_todo_ids() {
  local slug="$1" tack_id="$2"
  local tack_dir="\${TACK_HOME:-$HOME/.tack}/routes"
  local route_file="$tack_dir/$slug.yaml"
  [[ -f "$route_file" ]] || return
  local -a ids
  ids=( \${(f)"$(awk -v tid="$tack_id" '
    /^  - id: / { current = $3 }
    current == tid && /^      - id: [ab][0-9]/ { print $3 }
  ' "$route_file")"} )
  (( \${#ids} )) && compadd -a ids
}

_tack_link_urls() {
  local slug="$1" tack_id="$2"
  local tack_dir="\${TACK_HOME:-$HOME/.tack}/routes"
  local route_file="$tack_dir/$slug.yaml"
  [[ -f "$route_file" ]] || return
  local -a urls
  urls=( \${(f)"$(awk -v tid="$tack_id" '
    /^  - id: / { in_tack = ($3 == tid) ? 1 : 0; in_links = 0; next }
    in_tack && /^    links:/ { in_links = 1; next }
    in_tack && /^    [a-z]/ { in_links = 0 }
    in_tack && in_links && /^      url: / { print $2 }
  ' "$route_file")"} )
  (( \${#urls} )) && compadd -a urls
}

_tack_tree_path() {
  local tack_dir="\${TACK_HOME:-$HOME/.tack}/routes"
  [[ -d "$tack_dir" ]] || return
  local cur="\${words[CURRENT]}"
  local -a parts
  parts=("\${(@s:/:)cur}")
  local nparts=\${#parts}

  # slug/tack-id/ → complete aspects
  if (( nparts >= 3 )) || { (( nparts == 2 )) && [[ "$cur" == */*/  ]]; }; then
    local slug="\${parts[1]}"
    local tack_id="\${parts[2]}"
    local route_file="$tack_dir/$slug.yaml"
    [[ -f "$route_file" ]] || return
    local prefix="$slug/$tack_id/"
    local -a aspects
    # parse which aspects this tack actually has
    local in_tack=0 has_deliverable=0 has_before=0 has_after=0 has_links=0 has_depends=0
    while IFS= read -r line; do
      if [[ "$line" =~ '^  - id: (.+)' ]]; then
        [[ "\${match[1]}" == "$tack_id" ]] && in_tack=1 || { (( in_tack )) && break; }
      elif (( in_tack )); then
        [[ "$line" =~ '^    deliverable:' ]] && has_deliverable=1
        [[ "$line" =~ '^    before:' ]] && has_before=1
        [[ "$line" =~ '^    after:' ]] && has_after=1
        [[ "$line" =~ '^    links:' ]] && has_links=1
        [[ "$line" =~ '^    depends_on:' ]] && has_depends=1
      fi
    done < "$route_file"
    (( has_deliverable )) && aspects+=("\${prefix}deliverable")
    (( has_before )) && aspects+=("\${prefix}before")
    (( has_after )) && aspects+=("\${prefix}after")
    (( has_links )) && aspects+=("\${prefix}links")
    (( has_depends )) && aspects+=("\${prefix}depends_on")
    (( \${#aspects} )) && compadd -Q -a aspects
    return
  fi

  # slug/ → complete tack IDs
  if [[ "$cur" == */* ]]; then
    local slug="\${cur%%/*}"
    local route_file="$tack_dir/$slug.yaml"
    [[ -f "$route_file" ]] || return
    local -a tack_ids tack_descs
    local id summary
    while IFS= read -r line; do
      if [[ "$line" =~ '^  - id: (.+)' ]]; then
        id="\${match[1]}"
      elif [[ -n "$id" && "$line" =~ '^    summary: (.+)' ]]; then
        summary="\${match[1]}"
        tack_ids+=("$slug/$id")
        tack_descs+=("$slug/$id ($summary)")
        id=""
      fi
    done < "$route_file"
    (( \${#tack_ids} )) && compadd -S / -q -l -d tack_descs -a tack_ids
    return
  fi

  # no slash → complete route slugs
  local -a routes slugs descs
  local slug route_file open total
  routes=( "$tack_dir"/*.yaml(N:t:r) )
  for slug in "\${routes[@]}"; do
    route_file="$tack_dir/$slug.yaml"
    total=\$(grep -c '^  - id: ' "$route_file" 2>/dev/null || echo 0)
    open=\$(awk '/^  - id:/{t=1} t && /^    status:/{if(\$2!="done" && \$2!="dropped")c++; t=0} END{print c+0}' "$route_file")
    slugs+=("$slug")
    descs+=("$slug ($open open / $total total)")
  done
  (( \${#slugs} )) && compadd -S / -q -l -d descs -a slugs
}

_tack() {
  local -a commands
  commands=(
    'init:Create a new route'
    'status:Show route status'
    'list:List all routes'
    'tree:Browse routes and tacks'
    'add:Add a tack to a route'
    'start:Start working on a tack'
    'done:Mark a tack as done'
    'drop:Drop a tack (mark as dropped, keep in file)'
    'remove:Delete a tack from a route'
    'edit:Edit a tack summary'
    'merge:Merge a tack into another'
    'deliverable:Set a deliverable on a tack'
    'before:Add a pre-work todo'
    'after:Add a post-work todo'
    'todo:Manage todo items'
    'link:Add a link to a tack'
    'session:Record a session'
    'pin:Pin a route to the current cwd'
    'unpin:Clear the cwd pin'
    'rm:Delete a route'
    'install-cli:Drop a tack wrapper on PATH'
    'completions:Output shell completion script'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  local command="\${words[2]}"

  case "$command" in
    init)
      # tack init <slug> [--group <slug>]
      case "$CURRENT" in
        3) _message 'slug' ;;
        *) _arguments '--group[Group slug]:group:_tack_routes' ;;
      esac
      ;;
    status)
      # tack status [slug] [--json] [--all]
      case "$CURRENT" in
        3) _tack_routes; _arguments '--json[Output JSON]' '--all[Include dropped tacks]' ;;
        *) _arguments '--json[Output JSON]' '--all[Include dropped tacks]' ;;
      esac
      ;;
    list)
      # tack list [--json]
      _arguments '--json[Output JSON]'
      ;;
    tree)
      # tack tree [path] [-d <depth>]
      case "$CURRENT" in
        3) _tack_tree_path; _arguments '-d[Expansion depth (1-3)]:depth:(1 2 3)' '--depth[Expansion depth (1-3)]:depth:(1 2 3)' ;;
        *) _arguments '-d[Expansion depth (1-3)]:depth:(1 2 3)' '--depth[Expansion depth (1-3)]:depth:(1 2 3)' ;;
      esac
      ;;
    add)
      # tack add <slug> <summary> [--depends-on <id,...>]
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _message 'summary' ;;
        *) _arguments '--depends-on[Comma-separated tack IDs]:depends' ;;
      esac
      ;;
    start|done|drop)
      # tack {start|done|drop} <slug> <tack-id>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
      esac
      ;;
    remove)
      # tack remove <slug> <tack-id> [--force]
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
        *) _arguments '--force[Strip dependent references]' ;;
      esac
      ;;
    edit)
      # tack edit <slug> <tack-id> <summary>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
        5) _message 'summary' ;;
      esac
      ;;
    merge)
      # tack merge <slug> <source-id> <target-id>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
        5) _tack_tack_ids "\${words[3]}" ;;
      esac
      ;;
    deliverable)
      # tack deliverable <slug> <tack-id> <label> <url>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
        5) _message 'label' ;;
        6) _message 'url' ;;
      esac
      ;;
    before|after)
      # tack {before|after} <slug> <tack-id> <text>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
        5) _message 'text' ;;
      esac
      ;;
    todo)
      # tack todo {done|rm} <slug> <tack-id> <todo-id>
      case "$CURRENT" in
        3) local -a subcmds; subcmds=('done:Complete a todo' 'rm:Delete a todo'); _describe 'subcommand' subcmds ;;
        4) _tack_routes ;;
        5) _tack_tack_ids "\${words[4]}" ;;
        6) _tack_todo_ids "\${words[4]}" "\${words[5]}" ;;
      esac
      ;;
    link)
      # tack link {add|rm} ...
      case "$CURRENT" in
        3) local -a subcmds; subcmds=('add:Add a link' 'rm:Remove a link'); _describe 'subcommand' subcmds ;;
        4) _tack_routes ;;
        5) _tack_tack_ids "\${words[4]}" ;;
        *)
          case "\${words[3]}" in
            add)
              # tack link add <slug> <tack-id> <label> <url>
              case "$CURRENT" in
                6) _message 'label' ;;
                7) _message 'url' ;;
              esac
              ;;
            rm)
              # tack link rm <slug> <tack-id> <url>
              case "$CURRENT" in
                6) _tack_link_urls "\${words[4]}" "\${words[5]}" ;;
              esac
              ;;
          esac
          ;;
      esac
      ;;
    session)
      # tack session <slug> <session-id>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _message 'session-id' ;;
      esac
      ;;
    pin)
      # tack pin [<slug>]
      case "$CURRENT" in
        3) _tack_routes ;;
      esac
      ;;
    unpin)
      # tack unpin (no args)
      ;;
    rm)
      # tack rm <slug> [--force]
      case "$CURRENT" in
        3) _tack_routes ;;
        *) _arguments '--force[Skip confirmation]' ;;
      esac
      ;;
    install-cli)
      # tack install-cli [--dir <path>]
      _arguments '--dir[Install directory (default ~/.local/bin)]:dir:_files -/'
      ;;
    completions)
      # tack completions <shell>
      case "$CURRENT" in
        3) compadd zsh ;;
      esac
      ;;
  esac
}

_tack "$@"
`;
