package com.example.certidao.web;

import com.example.certidao.domain.Imovel;
import com.example.certidao.domain.Certidao;
import com.example.certidao.domain.CertidaoStatus;
import com.example.certidao.service.CertidaoService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/certidoes")
public class CertidaoController {

    private final CertidaoService service;

    public CertidaoController(CertidaoService service) {
        this.service = service;
    }

    @GetMapping("/{id}")
    public Certidao getById(@PathVariable Long id) {
        if (id == null) {
            throw new ValidationException("id is required");
        }
        return service.findById(id);
    }

    @PreAuthorize("hasRole('ANALISTA')")
    @PostMapping("/emitir")
    public Certidao emitir(@RequestBody Imovel imovel) {
        return service.emitir(imovel);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }
}
