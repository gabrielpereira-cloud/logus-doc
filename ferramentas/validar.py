#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Valida os arquivos <versao>.json da pasta versoes/.

Onde a hospedagem lista diretorio (nginx/Apache/S3) a pagina se vira sozinha.
Use --index quando ela NAO listar (GitHub Pages, Tomcat): gera o versoes/index.json
que a pagina usa como ultimo recurso.

Saida: erros (arquivo quebrado) retornam 1 e devem barrar o deploy; avisos de
convencao apenas aparecem. Com --estrito, aviso tambem retorna 1.
"""

import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "versoes"
INDICE = PASTA / "index.json"
TIPOS_VALIDOS = ("melhoria", "correcao")


def chave_ordem(versao):
    return [int(p) if p.isdigit() else -1 for p in re.split(r"[._-]", versao)]


def main():
    if not PASTA.is_dir():
        sys.exit("Pasta nao encontrada: %s" % PASTA)

    gerar_indice = "--index" in sys.argv
    estrito = "--estrito" in sys.argv

    versoes = []
    erros = []
    avisos = []

    for arquivo in sorted(PASTA.glob("*.json")):
        if arquivo.name == "index.json":
            continue

        if not re.match(r"^\d+(?:\.\d+)+$", arquivo.stem):
            erros.append("%s: nome fora do padrao (esperado 07.26.21.00.json)" % arquivo.name)
            continue

        try:
            dados = json.loads(arquivo.read_text(encoding="utf-8"))
        except ValueError as erro:
            erros.append("%s: JSON invalido (%s)" % (arquivo.name, erro))
            continue

        versao = dados.get("versao") or arquivo.stem
        if versao != arquivo.stem:
            erros.append(
                "%s: campo 'versao' (%s) diferente do nome do arquivo" % (arquivo.name, versao)
            )
        if not dados.get("data"):
            erros.append("%s: sem campo 'data'" % arquivo.name)
        elif not re.match(r"^\d{4}-\d{2}-\d{2}$", str(dados["data"])):
            erros.append("%s: data fora do padrao yyyy-MM-dd (%s)" % (arquivo.name, dados["data"]))
        if not dados.get("itens"):
            erros.append("%s: sem itens" % arquivo.name)

        for pos, item in enumerate(dados.get("itens") or [], start=1):
            if item.get("tipo") not in TIPOS_VALIDOS:
                erros.append("%s: item %d com tipo invalido (%s)"
                                 % (arquivo.name, pos, item.get("tipo")))
            if not item.get("texto"):
                erros.append("%s: item %d sem texto" % (arquivo.name, pos))
            func = item.get("funcionalidade")
            if func is None or func == "":
                continue
            if not isinstance(func, str):
                erros.append("%s: item %d com funcionalidade que nao e texto (%r)"
                                 % (arquivo.name, pos, func))
            elif not re.match(r"^\d+\s*-\s*\S", func):
                # convencao "<numero> - <Nome>"; nem sempre se aplica, entao e so aviso
                avisos.append("%s: item %d com funcionalidade fora do padrao '302 - Fornecedores' (%r)"
                                 % (arquivo.name, pos, func))

        versoes.append(versao)

    versoes.sort(key=chave_ordem, reverse=True)
    print("%d versao(oes) encontrada(s). Mais recente: %s"
          % (len(versoes), versoes[0] if versoes else "-"))

    if gerar_indice:
        INDICE.write_text(
            json.dumps({"versoes": versoes}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print("index.json (fallback) gerado.")

    for erro in erros:
        print("  ERRO:  %s" % erro)
    for aviso in avisos:
        print("  aviso: %s" % aviso)

    if erros:
        return 1
    return 1 if (estrito and avisos) else 0


if __name__ == "__main__":
    sys.exit(main())
