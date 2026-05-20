"""Minimal multipart/form-data parser (stdlib-only; replaces removed cgi module)."""


def _parse_content_disposition(value: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not value.lower().startswith('form-data'):
        return out
    rest = value.split(';', 1)[1] if ';' in value else ''
    for piece in rest.split(';'):
        piece = piece.strip()
        if '=' not in piece:
            continue
        key, val = piece.split('=', 1)
        key = key.strip().lower()
        val = val.strip().strip('"')
        out[key] = val
    return out


def parse_file_uploads(content_type: str, body: bytes, field_name: str = 'file') -> list[tuple[str, bytes]]:
    """Return (filename, file_bytes) for each matching multipart field."""
    boundary = None
    for piece in content_type.split(';'):
        piece = piece.strip()
        if piece.startswith('boundary='):
            boundary = piece.split('=', 1)[1].strip().strip('"')
            break
    if not boundary:
        return []

    delimiter = ('--' + boundary).encode('ascii')
    uploads: list[tuple[str, bytes]] = []

    for chunk in body.split(delimiter):
        chunk = chunk.strip(b'\r\n')
        if not chunk or chunk == b'--':
            continue
        if b'\r\n\r\n' not in chunk:
            continue
        header_block, data = chunk.split(b'\r\n\r\n', 1)
        data = data.rstrip(b'\r\n')

        disposition = ''
        for line in header_block.decode('utf-8', errors='replace').split('\r\n'):
            if line.lower().startswith('content-disposition:'):
                disposition = line.split(':', 1)[1].strip()
                break

        meta = _parse_content_disposition(disposition)
        if meta.get('name') != field_name:
            continue
        filename = meta.get('filename')
        if not filename:
            continue
        uploads.append((filename, data))

    return uploads
