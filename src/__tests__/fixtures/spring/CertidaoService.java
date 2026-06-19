package com.example.certidao.service;

import com.example.certidao.domain.Imovel;
import com.example.certidao.domain.Certidao;
import com.example.certidao.domain.CertidaoStatus;
import com.example.certidao.domain.TipoImovel;
import org.springframework.stereotype.Service;

@Service
public class CertidaoService {

    private final GeoService geo;

    public CertidaoService(GeoService geo) {
        this.geo = geo;
    }

    public Certidao emitir(Imovel imovel) {
        // validation throw
        if (imovel.getArea() == null) {
            throw new ValidationException("area is required");
        }

        // the documented spatial / business gate
        if (imovelContidoMunicipio(imovel) && imovel.getArea() <= 100) {
            imovel.setElegivel(true);
        } else {
            throw new BusinessRuleException("imovel nao elegivel");
        }

        // RURAL / URBANO branching over a status/type enum
        switch (imovel.getTipo()) {
            case RURAL:
                imovel.setStatus(CertidaoStatus.RURAL_PENDENTE);
                break;
            case URBANO:
                imovel.setStatus(CertidaoStatus.URBANO_PENDENTE);
                break;
            default:
                throw new ValidationException("tipo desconhecido");
        }

        // status-enum transition (assignment over a status enum)
        CertidaoStatus next = CertidaoStatus.EMITIDA;
        imovel.setStatus(next);

        return new Certidao(imovel);
    }

    private boolean imovelContidoMunicipio(Imovel imovel) {
        return geo.contains(imovel.getMunicipioGeom(), imovel.getGeom());
    }
}
